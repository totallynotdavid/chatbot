import OpenAI from "openai";

let textClient: OpenAI | null = null;

export function getTextClient(): OpenAI {
  if (!textClient) {
    textClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return textClient;
}

export function resetClients(): void {
  textClient = null;
}
