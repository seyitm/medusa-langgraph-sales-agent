import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createChatModel } from "../../src/agent/model.js";
import { MedusaClient } from "../../src/medusa/client.js";

const enabled = process.env.RUN_LIVE_SMOKE === "true";
const live = describe.skipIf(!enabled);

live("live provider and Medusa smoke tests", () => {
  const healthTool = tool(async () => "ok", {
    name: "health_check",
    description: "Return service health.",
    schema: z.object({}),
  });

  it.skipIf(!process.env.OPENAI_API_KEY || !process.env.OPENAI_SMOKE_MODEL)(
    "receives an OpenAI tool call",
    async () => {
      const model = createChatModel({
        provider: "openai",
        name: process.env.OPENAI_SMOKE_MODEL!,
        openAiApiKey: process.env.OPENAI_API_KEY,
        anthropicApiKey: undefined,
      });
      const response = await model.bindTools!([healthTool]).invoke(
        "Call the health_check tool now. Do not answer directly.",
      );
      expect(response.tool_calls?.[0]?.name).toBe("health_check");
    },
  );

  it.skipIf(!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_SMOKE_MODEL)(
    "receives an Anthropic tool call",
    async () => {
      const model = createChatModel({
        provider: "anthropic",
        name: process.env.ANTHROPIC_SMOKE_MODEL!,
        openAiApiKey: undefined,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      });
      const response = await model.bindTools!([healthTool]).invoke(
        "Call the health_check tool now. Do not answer directly.",
      );
      expect(response.tool_calls?.[0]?.name).toBe("health_check");
    },
  );

  it.skipIf(
    !process.env.MEDUSA_BACKEND_URL ||
      !process.env.MEDUSA_PUBLISHABLE_KEY ||
      !process.env.SMOKE_REGION_ID,
  )("reads one live Medusa catalog page", async () => {
    const commerce = new MedusaClient({
      backendUrl: process.env.MEDUSA_BACKEND_URL!,
      publishableKey: process.env.MEDUSA_PUBLISHABLE_KEY!,
    });
    const result = await commerce.searchProducts(
      { limit: 1 },
      { regionId: process.env.SMOKE_REGION_ID! },
    );
    expect(result.limit).toBe(1);
    expect(result.products.length).toBeLessThanOrEqual(1);
  });
});
