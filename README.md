# Medusa LangGraph Sales Agent

A shopper-facing TypeScript agent for Medusa v2. It uses live Store API data for product discovery and comparisons, remembers conversation state in PostgreSQL, streams responses over SSE, and pauses for explicit approval before every cart mutation.

## What it can do

- Search products, categories, and collections using current Medusa data.
- Compare two to four products with live regional price and inventory information.
- Read a storefront-owned cart.
- Propose add, quantity-change, and remove operations.
- Resume an approved operation safely through a LangGraph interrupt.

It cannot access Admin APIs, answer store-policy questions, create carts, collect checkout data, take payments, or place orders.

## Quick start

Requirements: Node.js 22+, pnpm, Docker, an existing Medusa v2 backend, a publishable API key, and either an OpenAI or Anthropic API key.

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm db:setup
pnpm dev
```

Edit `.env` before `db:setup`. The service listens on `http://localhost:3100`, interactive API documentation is at `http://localhost:3100/docs`, and readiness is at `http://localhost:3100/health/ready`.

## API usage

Session tokens must be minted by a trusted storefront backend. Replace the context values with a cart and region from your storefront.

```bash
curl -sS http://localhost:3100/v1/session-tokens \
  -H 'content-type: application/json' \
  -H 'x-session-issuer-key: replace-with-an-independent-random-secret' \
  -d '{
    "subject":"anonymous-browser-session-123",
    "context":{"cartId":"cart_123","regionId":"reg_123","countryCode":"tr","locale":"en-US"}
  }'
```

Copy `threadId` and `token` from the response:

```bash
curl -N http://localhost:3100/v1/threads/THREAD_ID/messages \
  -H 'authorization: Bearer SESSION_TOKEN' \
  -H 'content-type: application/json' \
  -d '{
    "message":"Find me a blue shirt under my current regional pricing",
    "context":{"cartId":"cart_123","regionId":"reg_123","countryCode":"tr","locale":"en-US"}
  }'
```

If the stream emits `approval.required`, resume with its `interruptId`:

```bash
curl -N http://localhost:3100/v1/threads/THREAD_ID/approvals/INTERRUPT_ID \
  -H 'authorization: Bearer SESSION_TOKEN' \
  -H 'content-type: application/json' \
  -d '{
    "decision":"approve",
    "context":{"cartId":"cart_123","regionId":"reg_123","countryCode":"tr","locale":"en-US"}
  }'
```

## Commands

```bash
pnpm typecheck       # Validate all TypeScript contracts
pnpm test            # Run deterministic tests without paid model calls
pnpm test:smoke      # Run opt-in live provider/Medusa checks when enabled
pnpm build           # Compile production JavaScript
pnpm db:cleanup      # Delete threads past their 30-day retention window
```

Set `RUN_LIVE_SMOKE=true` and the smoke-test variables in `.env` to exercise real OpenAI, Anthropic, and Medusa integrations. Individual checks skip when their required credentials are absent.

## Production deployment

Build and run the immutable container image:

```bash
docker build -t registry.example.com/medusa-sales-agent:0.1.0 .
docker push registry.example.com/medusa-sales-agent:0.1.0
```

The runtime requires PostgreSQL, a reachable Medusa v2 backend, and one configured model provider. Supply secrets through the deployment platform rather than a committed environment file. Set `NODE_ENV=production`, use unique high-entropy values for `JWT_SECRET` and `SESSION_ISSUER_KEY`, restrict `CORS_ORIGINS`, configure `TRUST_PROXY` for the ingress topology, and keep `ENABLE_API_DOCS=false` unless the documentation endpoint is intentionally exposed.

The container runs as an unprivileged user and exposes port `3100`. Configure orchestration probes as follows:

- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`
- Metrics: `GET /metrics`, optionally protected with `METRICS_TOKEN`

PostgreSQL schema setup is idempotent and runs at application startup. Thread cleanup also runs hourly in-process; `pnpm db:cleanup` can be scheduled externally when operational policy requires a separate retention job.

## Security boundaries

- Deploy one service instance per Medusa store and publishable API key.
- Keep `/v1/session-tokens` server-to-server; never expose the issuer key to browser code.
- Reissue a session token whenever the shopper's cart or region changes.
- Terminate TLS at the ingress or load balancer and require encrypted PostgreSQL connections in production.
- Do not add Medusa Admin credentials to this service.
- Restrict metrics and API documentation at the network layer in addition to application configuration.

## License

Copyright 2026 Seyit Mustafa Demir.

This project is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). Personal, educational, research, and other qualifying non-commercial uses are permitted under its terms. No commercial-use rights are granted to third parties. Commercial use requires a separate written license from the copyright owner.
