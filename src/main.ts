import { createSalesGraph } from "./agent/graph.js";
import { createChatModel } from "./agent/model.js";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MedusaClient } from "./medusa/client.js";
import { AgentDatabase } from "./persistence/database.js";

const config = loadConfig();
const database = new AgentDatabase(config.databaseUrl);
await database.setup();

const commerce = new MedusaClient(config.medusa);
const model = createChatModel(config.model);
const graph = createSalesGraph({
  model,
  commerce,
  database,
  checkpointer: database.checkpointer,
  approvalTtlSeconds: config.approvalTtlSeconds,
});
const app = await buildApp({ config, database, graph });

const cleanupTimer = setInterval(() => {
  void database.cleanupExpiredThreads().catch((error: unknown) => {
    app.log.error({ err: error }, "thread retention cleanup failed");
  });
}, 60 * 60 * 1000);
cleanupTimer.unref();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  clearInterval(cleanupTimer);
  const forceExit = setTimeout(() => {
    app.log.error({ timeoutMs: config.shutdownTimeoutMs }, "graceful shutdown timed out");
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceExit.unref();
  try {
    await app.close();
    await database.close();
    clearTimeout(forceExit);
  } catch (error) {
    app.log.error({ err: error }, "graceful shutdown failed");
    process.exitCode = 1;
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
