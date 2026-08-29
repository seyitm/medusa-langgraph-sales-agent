import { loadConfig } from "../config.js";
import { AgentDatabase } from "../persistence/database.js";

const config = loadConfig();
const database = new AgentDatabase(config.databaseUrl);

try {
  await database.setup();
  process.stdout.write("Database and LangGraph checkpoint tables are ready.\n");
} finally {
  await database.close();
}
