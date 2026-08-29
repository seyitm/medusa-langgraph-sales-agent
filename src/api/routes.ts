import { randomUUID } from "node:crypto";
import { HumanMessage } from "@langchain/core/messages";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { createSalesGraph } from "../agent/graph.js";
import {
  contextMatches,
  issuerKeyMatches,
  issueSessionToken,
  normalizeStoreContext,
  storeContextSchema,
  verifySessionToken,
  type SessionClaims,
} from "../auth/session-token.js";
import type { AppConfig } from "../config.js";
import type { ToolRuntimeContext } from "../domain/types.js";
import { AppError, asAppError } from "../errors.js";
import type { AgentDatabase } from "../persistence/database.js";
import { resumeCommand, streamGraphRun } from "./graph-stream.js";
import { openSse } from "./sse.js";

const issueTokenBody = z.object({
  subject: z.string().min(1).max(128),
  threadId: z.uuid().optional(),
  context: storeContextSchema,
});

const messageBody = z.object({
  message: z.string().trim().min(1).max(8_000),
  context: storeContextSchema,
});

const approvalBody = z.object({
  decision: z.enum(["approve", "reject"]),
  context: storeContextSchema,
});

const threadParams = z.object({ threadId: z.uuid() });
const approvalParams = threadParams.extend({ interruptId: z.string().min(1) });

function jsonSchema(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: "draft-7" });
}

type SalesGraph = ReturnType<typeof createSalesGraph>;

function bearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AppError("AUTH_FAILED", "A bearer session token is required", 401);
  }
  return header.slice("Bearer ".length);
}

async function authorizeThread(options: {
  request: FastifyRequest;
  threadId: string;
  config: AppConfig;
  database: AgentDatabase;
}): Promise<SessionClaims> {
  const claims = await verifySessionToken(bearerToken(options.request), options.config.auth);
  if (claims.threadId !== options.threadId) {
    throw new AppError("AUTH_FAILED", "The token is not valid for this thread", 403);
  }
  if (!(await options.database.subjectOwnsThread(options.threadId, claims.subject))) {
    throw new AppError("AUTH_FAILED", "The thread does not belong to this session", 403);
  }
  return claims;
}

function assertContext(claims: SessionClaims, context: z.infer<typeof storeContextSchema>): void {
  if (!contextMatches(claims.store, context)) {
    throw new AppError("CONTEXT_MISMATCH", "Request context does not match the signed session", 409);
  }
}

function runtime(claims: SessionClaims): ToolRuntimeContext {
  return { subject: claims.subject, threadId: claims.threadId, store: claims.store };
}

function serializeMessage(message: { getType(): string; content: unknown }) {
  return { role: message.getType(), content: message.content };
}

export async function registerRoutes(
  app: FastifyInstance,
  dependencies: { config: AppConfig; database: AgentDatabase; graph: SalesGraph },
): Promise<void> {
  app.get("/health/live", { config: { rateLimit: false }, schema: { tags: ["health"], summary: "Process liveness" } }, async () => ({ status: "ok" }));
  app.get("/health/ready", { config: { rateLimit: false }, schema: { tags: ["health"], summary: "Database readiness" } }, async (_request, reply) => {
    const ready = await dependencies.database.ready();
    if (!ready) return reply.code(503).send({ status: "not_ready" });
    return { status: "ready" };
  });

  app.post("/v1/session-tokens", {
    schema: {
      tags: ["sessions"],
      summary: "Issue a short-lived storefront session token",
      security: [{ sessionIssuerKey: [] }],
      body: jsonSchema(issueTokenBody),
    },
  }, async (request, reply) => {
    const receivedKey = request.headers["x-session-issuer-key"];
    if (
      typeof receivedKey !== "string" ||
      !issuerKeyMatches(dependencies.config.auth.sessionIssuerKey, receivedKey)
    ) {
      throw new AppError("AUTH_FAILED", "The session issuer key is invalid", 401);
    }
    const body = issueTokenBody.parse(request.body);
    const normalizedContext = normalizeStoreContext(body.context);
    const threadId = body.threadId ?? randomUUID();
    await dependencies.database.touchThread(
      threadId,
      body.subject,
      dependencies.config.threadRetentionDays,
    );
    const result = await issueSessionToken(
      { subject: body.subject, threadId, store: normalizedContext },
      dependencies.config.auth,
    );
    return reply.code(201).send({ threadId, ...result });
  });

  app.post("/v1/threads/:threadId/messages", {
    schema: {
      tags: ["threads"],
      summary: "Stream an agent turn using server-sent events",
      security: [{ bearerSession: [] }],
      params: jsonSchema(threadParams),
      body: jsonSchema(messageBody),
    },
  }, async (request, reply) => {
    const { threadId } = threadParams.parse(request.params);
    const body = messageBody.parse(request.body);
    const claims = await authorizeThread({ request, threadId, ...dependencies });
    assertContext(claims, normalizeStoreContext(body.context));
    await dependencies.database.touchThread(
      threadId,
      claims.subject,
      dependencies.config.threadRetentionDays,
    );

    const writer = openSse(reply);
    try {
      await streamGraphRun({
        graph: dependencies.graph,
        input: {
          messages: [new HumanMessage(body.message)],
          runtime: runtime(claims),
          pendingAction: null,
          approvalDecision: null,
          lastProducts: [],
          lastArtifactType: null,
          lastCart: null,
        },
        threadId,
        writer,
      });
    } catch (error) {
      const normalized = asAppError(error);
      request.log.error({ err: normalized, code: normalized.code }, "graph stream failed");
      writer.send("error", {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      });
      writer.send("done", { interrupted: false, error: true });
    } finally {
      writer.close();
    }
  });

  app.post("/v1/threads/:threadId/approvals/:interruptId", {
    schema: {
      tags: ["threads"],
      summary: "Approve or reject a pending cart mutation",
      security: [{ bearerSession: [] }],
      params: jsonSchema(approvalParams),
      body: jsonSchema(approvalBody),
    },
  }, async (request, reply) => {
    const { threadId, interruptId } = approvalParams.parse(request.params);
    const body = approvalBody.parse(request.body);
    const claims = await authorizeThread({ request, threadId, ...dependencies });
    assertContext(claims, normalizeStoreContext(body.context));

    const snapshot = await dependencies.graph.getState({ configurable: { thread_id: threadId } });
    const pendingIds = snapshot.tasks.flatMap((task) => task.interrupts.map((item) => item.id));
    if (!pendingIds.includes(interruptId)) {
      throw new AppError("NOT_FOUND", "The pending approval was not found", 404);
    }

    const writer = openSse(reply);
    try {
      await streamGraphRun({
        graph: dependencies.graph,
        input: resumeCommand(body.decision),
        threadId,
        writer,
      });
    } catch (error) {
      const normalized = asAppError(error);
      request.log.error({ err: normalized, code: normalized.code }, "approval stream failed");
      writer.send("error", {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      });
      writer.send("done", { interrupted: false, error: true });
    } finally {
      writer.close();
    }
  });

  app.get("/v1/threads/:threadId", {
    schema: {
      tags: ["threads"],
      summary: "Restore a thread transcript and pending approval",
      security: [{ bearerSession: [] }],
      params: jsonSchema(threadParams),
    },
  }, async (request) => {
    const { threadId } = threadParams.parse(request.params);
    await authorizeThread({ request, threadId, ...dependencies });
    const snapshot = await dependencies.graph.getState({ configurable: { thread_id: threadId } });
    const state = snapshot.values as { messages?: Array<{ getType(): string; content: unknown }> };
    const pending = snapshot.tasks.flatMap((task) =>
      task.interrupts.map((item) => ({ interruptId: item.id, value: item.value })),
    )[0];
    return {
      threadId,
      messages: (state.messages ?? [])
        .filter((message) => ["human", "ai"].includes(message.getType()))
        .map(serializeMessage),
      pendingApproval: pending ?? null,
    };
  });

  app.delete("/v1/threads/:threadId", {
    schema: {
      tags: ["threads"],
      summary: "Delete a thread and its checkpoints",
      security: [{ bearerSession: [] }],
      params: jsonSchema(threadParams),
    },
  }, async (request, reply) => {
    const { threadId } = threadParams.parse(request.params);
    await authorizeThread({ request, threadId, ...dependencies });
    await dependencies.database.deleteThread(threadId);
    return reply.code(204).send();
  });
}
