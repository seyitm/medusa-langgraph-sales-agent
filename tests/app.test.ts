import type { createSalesGraph } from "../src/agent/graph.js";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import type { AgentDatabase } from "../src/persistence/database.js";
import { describe, expect, it, vi } from "vitest";

const config = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3100,
  logLevel: "silent",
  trustProxy: false,
  enableApiDocs: true,
  shutdownTimeoutMs: 10_000,
  databaseUrl: "postgresql://unused/test",
  medusa: { backendUrl: "http://localhost:9000", publishableKey: "pk_test" },
  model: { provider: "openai", name: "fake", openAiApiKey: "fake" },
  auth: {
    jwtSecret: "test-secret-that-is-definitely-over-32-characters",
    issuer: "test-issuer",
    audience: "test-audience",
    sessionIssuerKey: "test-session-issuer-secret",
    tokenTtlSeconds: 900,
  },
  approvalTtlSeconds: 600,
  threadRetentionDays: 30,
  corsOrigins: ["http://localhost:8000"],
  rateLimit: { max: 60, timeWindow: "1 minute" },
  metricsToken: undefined,
} as AppConfig;

describe("HTTP application", () => {
  const database = {
    ready: vi.fn(async () => true),
    touchThread: vi.fn(async () => undefined),
  } as unknown as AgentDatabase;
  const graph = {} as ReturnType<typeof createSalesGraph>;

  it("publishes OpenAPI routes and issues a signed session token", async () => {
    const app = await buildApp({ config, database, graph });

    try {
      await app.ready();
      const document = app.swagger() as { paths: Record<string, unknown> };
      expect(document.paths["/v1/threads/{threadId}/messages"]).toBeDefined();

      const response = await app.inject({
        method: "POST",
        url: "/v1/session-tokens",
        headers: { "x-session-issuer-key": config.auth.sessionIssuerKey },
        payload: {
          subject: "browser-session-1",
          context: { cartId: "cart_1", regionId: "reg_1", countryCode: "TR" },
        },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({ threadId: expect.any(String), token: expect.any(String) });
      expect(database.touchThread).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("keeps documentation disabled and protects metrics when configured", async () => {
    const productionConfig = {
      ...config,
      enableApiDocs: false,
      metricsToken: "production-metrics-token-with-entropy",
    };
    const app = await buildApp({ config: productionConfig, database, graph });

    try {
      const docs = await app.inject({ method: "GET", url: "/docs" });
      expect(docs.statusCode).toBe(404);

      const unauthorized = await app.inject({ method: "GET", url: "/metrics" });
      expect(unauthorized.statusCode).toBe(401);

      const authorized = await app.inject({
        method: "GET",
        url: "/metrics",
        headers: { authorization: `Bearer ${productionConfig.metricsToken}` },
      });
      expect(authorized.statusCode).toBe(200);
      expect(authorized.body).toContain("agent_http_requests_total");
    } finally {
      await app.close();
    }
  });
});
