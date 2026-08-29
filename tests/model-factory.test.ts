import { describe, expect, it } from "vitest";
import { createChatModel } from "../src/agent/model.js";

describe("provider-neutral model factory", () => {
  it("constructs the OpenAI adapter", () => {
    const model = createChatModel({
      provider: "openai",
      name: "fake-openai-model",
      openAiApiKey: "fake-key",
      anthropicApiKey: undefined,
    });
    expect(model._llmType()).toContain("openai");
  });

  it("constructs the Anthropic adapter", () => {
    const model = createChatModel({
      provider: "anthropic",
      name: "fake-anthropic-model",
      openAiApiKey: undefined,
      anthropicApiKey: "fake-key",
    });
    expect(model._llmType()).toContain("anthropic");
  });
});
