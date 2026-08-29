import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const baseEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://localhost/test",
  MEDUSA_BACKEND_URL: "http://localhost:9000/",
  MEDUSA_PUBLISHABLE_KEY: "pk_test",
  MODEL_PROVIDER: "openai",
  MODEL_NAME: "test-model",
  OPENAI_API_KEY: "test-key",
  JWT_SECRET: "test-secret-that-is-definitely-over-32-characters",
  SESSION_ISSUER_KEY: "test-session-issuer-secret",
};

describe("configuration", () => {
  it("normalizes URLs and applies safe defaults", () => {
    const config = loadConfig(baseEnvironment);
    expect(config.medusa.backendUrl).toBe("http://localhost:9000");
    expect(config.port).toBe(3100);
    expect(config.threadRetentionDays).toBe(30);
  });

  it("requires the selected provider's API key", () => {
    expect(() => loadConfig({ ...baseEnvironment, OPENAI_API_KEY: "" })).toThrow(
      "OPENAI_API_KEY is required",
    );
  });

  it("disables API documentation by default in production", () => {
    const config = loadConfig({ ...baseEnvironment, NODE_ENV: "production" });
    expect(config.enableApiDocs).toBe(false);
    expect(config.trustProxy).toBe(false);
  });
});
