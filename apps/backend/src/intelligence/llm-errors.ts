export type LLMErrorType =
  | "timeout"
  | "invalid_json"
  | "safety_filter"
  | "rate_limit"
  | "api_error"
  | "unknown";

export type LLMError = {
  type: LLMErrorType;
  message: string;
};

export function classifyLLMError(error: unknown): LLMError {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (msg.includes("timeout") || msg.includes("timed out")) {
      return { type: "timeout", message: error.message };
    }

    if (
      msg.includes("json") ||
      msg.includes("parse") ||
      msg.includes("unexpected token")
    ) {
      return { type: "invalid_json", message: error.message };
    }

    if (
      msg.includes("content_filter") ||
      msg.includes("safety") ||
      msg.includes("blocked")
    ) {
      return { type: "safety_filter", message: error.message };
    }

    if (msg.includes("rate") || msg.includes("429") || msg.includes("quota")) {
      return { type: "rate_limit", message: error.message };
    }

    if (
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("api") ||
      msg.includes("network")
    ) {
      return { type: "api_error", message: error.message };
    }

    return { type: "unknown", message: error.message };
  }

  return { type: "unknown", message: String(error) };
}
