import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { Command } from "@langchain/langgraph";
import type { ApprovalDecision, createSalesGraph, SalesAgentStateValue } from "../agent/graph.js";
import type { ToolRuntimeContext } from "../domain/types.js";
import type { SseWriter } from "./sse.js";

type SalesGraph = ReturnType<typeof createSalesGraph>;

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const candidate = block as { type?: string; text?: string };
      return candidate.type === "text" && typeof candidate.text === "string" ? candidate.text : "";
    })
    .join("");
}

function latestAssistantText(messages: BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof AIMessage && !(message.tool_calls?.length)) {
      return textFromContent(message.content);
    }
  }
  return "";
}

function pendingInterrupt(snapshot: Awaited<ReturnType<SalesGraph["getState"]>>) {
  for (const task of snapshot.tasks) {
    for (const item of task.interrupts ?? []) {
      return { id: item.id, value: item.value };
    }
  }
  return undefined;
}

export async function streamGraphRun(options: {
  graph: SalesGraph;
  input:
    | {
        messages: BaseMessage[];
        runtime: ToolRuntimeContext;
        pendingAction?: null;
        approvalDecision?: null;
        lastProducts?: [];
        lastArtifactType?: null;
        lastCart?: null;
      }
    | Command;
  threadId: string;
  writer: SseWriter;
}): Promise<void> {
  const graphConfig = { configurable: { thread_id: options.threadId } };
  const events = await options.graph.streamEvents(options.input as never, {
    ...graphConfig,
    version: "v2",
  });

  for await (const event of events) {
    if (event.event !== "on_chat_model_stream") continue;
    if (event.tags?.includes("internal-summary")) continue;
    const chunk = (event.data as { chunk?: { content?: unknown } }).chunk;
    const delta = textFromContent(chunk?.content);
    if (delta) options.writer.send("response.delta", { delta });
  }

  const snapshot = await options.graph.getState(graphConfig);
  const state = snapshot.values as SalesAgentStateValue;
  const waiting = pendingInterrupt(snapshot);

  if (state.lastProducts.length) {
    options.writer.send(state.lastArtifactType === "comparison" ? "comparison" : "products", {
      items: state.lastProducts,
    });
  }
  if (state.lastCart && !waiting) {
    options.writer.send("cart.updated", { cart: state.lastCart });
  }
  if (waiting) {
    options.writer.send("approval.required", {
      interruptId: waiting.id,
      ...((waiting.value as object) ?? {}),
    });
  } else {
    options.writer.send("response.completed", {
      text: latestAssistantText(state.messages),
    });
  }
  options.writer.send("done", { interrupted: Boolean(waiting) });
}

export function resumeCommand(decision: ApprovalDecision): Command {
  return new Command({ resume: decision });
}
