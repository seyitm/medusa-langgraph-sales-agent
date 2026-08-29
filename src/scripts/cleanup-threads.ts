import { loadConfig } from "../config.js";
import { AgentDatabase } from "../persistence/database.js";

const config = loadConfig();
const database = new AgentDatabase(config.databaseUrl);

try {
  const deleted = await database.cleanupExpiredThreads();
  process.stdout.write(`Deleted ${deleted} expired thread(s).\n`);
} finally {
  await database.close();
}
