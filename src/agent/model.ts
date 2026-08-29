import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import type { AppConfig } from "../config.js";

export function createChatModel(config: AppConfig["model"]): BaseChatModel {
  if (config.provider === "openai") {
    return new ChatOpenAI({
      model: config.name,
      apiKey: config.openAiApiKey!,
      temperature: 0,
      streaming: true,
      maxRetries: 2,
    });
  }

  return new ChatAnthropic({
    model: config.name,
    apiKey: config.anthropicApiKey!,
    temperature: 0,
    streaming: true,
    maxRetries: 2,
  });
}
