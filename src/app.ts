import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import { ZodError } from "zod";
import type { createSalesGraph } from "./agent/graph.js";
import { registerRoutes } from "./api/routes.js";
import type { AppConfig } from "./config.js";
import { AppError, asAppError } from "./errors.js";
import { issuerKeyMatches } from "./auth/session-token.js";
import { Metrics } from "./metrics.js";
import type { AgentDatabase } from "./persistence/database.js";

export async function buildApp(dependencies: {
  config: AppConfig;
  database: AgentDatabase;
  graph: ReturnType<typeof createSalesGraph>;
}) {
  const metrics = new Metrics();
  const requestStarts = new WeakMap<object, number>();
  const app = Fastify({
    logger: {
      level: dependencies.config.logLevel,
      redact: [
        "req.headers.authorization",
        "req.headers.x-session-issuer-key",
        "body.context.cartId",
      ],
    },
    bodyLimit: 16 * 1024,
    requestIdHeader: "x-request-id",
    trustProxy: dependencies.config.trustProxy,
  });

  await app.register(cors, {
    origin: dependencies.config.corsOrigins,
    methods: ["GET", "POST", "DELETE"],
  });
  await app.register(rateLimit, dependencies.config.rateLimit);
  if (dependencies.config.enableApiDocs) {
    await app.register(swagger, {
      openapi: {
        info: { title: "Medusa LangGraph Sales Agent", version: "0.1.0" },
        components: {
          securitySchemes: {
            bearerSession: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
            sessionIssuerKey: { type: "apiKey", in: "header", name: "x-session-issuer-key" },
          },
        },
      },
    });
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  app.addHook("onRequest", async (request) => {
    requestStarts.set(request, performance.now());
  });
  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStarts.get(request);
    if (typeof startedAt === "number") {
      metrics.observe(performance.now() - startedAt, reply.statusCode >= 500);
    }
  });

  app.get("/metrics", { config: { rateLimit: false } }, async (request, reply) => {
    if (dependencies.config.metricsToken) {
      const authorization = request.headers.authorization;
      const received = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : undefined;
      if (!issuerKeyMatches(dependencies.config.metricsToken, received)) {
        throw new AppError("AUTH_FAILED", "A valid metrics bearer token is required", 401);
      }
    }
    return reply.type("text/plain; version=0.0.4").send(metrics.render());
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = error instanceof ZodError
      ? new AppError("INVALID_REQUEST", "Request validation failed", 400, false, { cause: error })
      : asAppError(error);
    request.log.error({ err: error, code: normalized.code }, "request failed");
    return reply.code(normalized.statusCode).send({
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      },
    });
  });

  await registerRoutes(app, dependencies);
  return app;
}
