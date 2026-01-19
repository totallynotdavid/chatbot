export function parseLLMResponse<T = Record<string, unknown>>(
  content: string | null | undefined,
  defaultValue: T,
): T {
  if (!content) {
    return defaultValue;
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    return defaultValue;
  }
}

export function extractString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}
