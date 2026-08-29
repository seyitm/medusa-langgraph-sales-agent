import type { FastifyReply } from "fastify";

export type SseEventName =
  | "response.delta"
  | "products"
  | "comparison"
  | "approval.required"
  | "cart.updated"
  | "response.completed"
  | "error"
  | "done";

export interface SseWriter {
  send(event: SseEventName, data: unknown): void;
  close(): void;
}

export function openSse(reply: FastifyReply): SseWriter {
  reply.hijack();
  reply.raw.statusCode = 200;
  reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.flushHeaders();

  return {
    send(event, data) {
      if (reply.raw.destroyed || reply.raw.writableEnded) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      if (!reply.raw.writableEnded) reply.raw.end();
    },
  };
}
