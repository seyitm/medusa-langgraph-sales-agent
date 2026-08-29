import { createHash } from "node:crypto";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";
import type { Cart } from "../domain/types.js";

export interface ExecutionRecord {
  actionId: string;
  threadId: string;
  status: "executing" | "completed" | "failed";
  desiredQuantity: number;
  result?: Cart;
  errorCode?: string;
}

export class AgentDatabase {
  readonly pool: Pool;
  readonly checkpointer: PostgresSaver;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
    this.checkpointer = PostgresSaver.fromConnString(databaseUrl, { schema: "agent_checkpoints" });
  }

  async setup(): Promise<void> {
    await this.pool.query("CREATE SCHEMA IF NOT EXISTS agent_checkpoints");
    await this.checkpointer.setup();
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_threads (
        thread_id TEXT PRIMARY KEY,
        subject_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_mutation_executions (
        action_id UUID PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES agent_threads(thread_id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('executing', 'completed', 'failed')),
        desired_quantity INTEGER NOT NULL,
        result_json JSONB,
        error_code TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS agent_threads_expires_at_idx ON agent_threads(expires_at)",
    );
  }

  async touchThread(threadId: string, subject: string, retentionDays: number): Promise<void> {
    const subjectHash = createHash("sha256").update(subject).digest("hex");
    await this.pool.query(
      `INSERT INTO agent_threads (thread_id, subject_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 day'))
       ON CONFLICT (thread_id) DO UPDATE SET
         updated_at = NOW(),
         expires_at = EXCLUDED.expires_at`,
      [threadId, subjectHash, retentionDays],
    );
  }

  async subjectOwnsThread(threadId: string, subject: string): Promise<boolean> {
    const subjectHash = createHash("sha256").update(subject).digest("hex");
    const result = await this.pool.query<{ owned: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM agent_threads WHERE thread_id = $1 AND subject_hash = $2) AS owned",
      [threadId, subjectHash],
    );
    return result.rows[0]?.owned ?? false;
  }

  async beginExecution(
    actionId: string,
    threadId: string,
    desiredQuantity: number,
  ): Promise<{ inserted: boolean; record: ExecutionRecord }> {
    const inserted = await this.pool.query(
      `INSERT INTO agent_mutation_executions (action_id, thread_id, status, desired_quantity)
       VALUES ($1, $2, 'executing', $3)
       ON CONFLICT (action_id) DO NOTHING
       RETURNING action_id`,
      [actionId, threadId, desiredQuantity],
    );
    const record = await this.getExecution(actionId);
    if (!record) throw new Error("Execution ledger insert could not be read back");
    return { inserted: (inserted.rowCount ?? 0) > 0, record };
  }

  async getExecution(actionId: string): Promise<ExecutionRecord | undefined> {
    const result = await this.pool.query<{
      action_id: string;
      thread_id: string;
      status: ExecutionRecord["status"];
      desired_quantity: number;
      result_json: Cart | null;
      error_code: string | null;
    }>(
      `SELECT action_id, thread_id, status, desired_quantity, result_json, error_code
       FROM agent_mutation_executions WHERE action_id = $1`,
      [actionId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      actionId: row.action_id,
      threadId: row.thread_id,
      status: row.status,
      desiredQuantity: row.desired_quantity,
      ...(row.result_json ? { result: row.result_json } : {}),
      ...(row.error_code ? { errorCode: row.error_code } : {}),
    };
  }

  async completeExecution(actionId: string, cart: Cart): Promise<void> {
    await this.pool.query(
      `UPDATE agent_mutation_executions
       SET status = 'completed', result_json = $2, updated_at = NOW()
       WHERE action_id = $1`,
      [actionId, JSON.stringify(cart)],
    );
  }

  async failExecution(actionId: string, errorCode: string): Promise<void> {
    await this.pool.query(
      `UPDATE agent_mutation_executions
       SET status = 'failed', error_code = $2, updated_at = NOW()
       WHERE action_id = $1`,
      [actionId, errorCode],
    );
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.checkpointer.deleteThread(threadId);
    await this.pool.query("DELETE FROM agent_threads WHERE thread_id = $1", [threadId]);
  }

  async cleanupExpiredThreads(): Promise<number> {
    const expired = await this.pool.query<{ thread_id: string }>(
      "SELECT thread_id FROM agent_threads WHERE expires_at < NOW()",
    );
    for (const row of expired.rows) await this.deleteThread(row.thread_id);
    return expired.rowCount ?? 0;
  }

  async ready(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await Promise.all([this.checkpointer.end(), this.pool.end()]);
  }
}
