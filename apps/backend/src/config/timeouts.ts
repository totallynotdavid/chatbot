// Values are in milliseconds
export const TIMEOUTS = {
  // Conversation locks
  LOCK_DEFAULT: 30_000,

  // External API calls
  FNB_AUTH: 10_000,
  FNB_QUERY: 15_000,
  POWERBI_QUERY: 20_000,

  // WhatsApp API
  WHATSAPP_SEND: 10_000,
  WHATSAPP_IMAGE: 15_000,

  // Notifier service
  NOTIFIER: 5_000,
} as const;

/**
 * Helper to create AbortController with timeout
 * Automatically cleans up timer
 */
export function createAbortTimeout(ms: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}
