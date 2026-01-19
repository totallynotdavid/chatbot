import OpenAI from "openai";

let textClient: OpenAI | null = null;
let visionClient: OpenAI | null = null;

export function getTextClient(): OpenAI {
  if (!textClient) {
    textClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return textClient;
}

export function getVisionClient(): OpenAI {
  if (!visionClient) {
    visionClient = new OpenAI({
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  }
  return visionClient;
}

export function resetClients(): void {
  textClient = null;
  visionClient = null;
}
