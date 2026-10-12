import { fetchApi } from "./api.ts";

/** What an action needs from the page that runs it. */
export type ConversationActionContext = {
  phoneNumber: string;
  /** The `?channel=` query the page addresses the conversation with, or "". */
  channelQuery: string;
  /** Reloads the conversation after the request went through. */
  refresh: () => Promise<void>;
  notify: {
    success: (message: string) => void;
    error: (message: string) => void;
  };
};

/**
 * Posts one action to the conversation. A refusal, such as the 409 for a
 * conversation another agent holds or one that is busy, is shown as the
 * server's message, and the conversation is left as the page loaded it.
 */
async function post(
  context: ConversationActionContext,
  action: string,
  successMessage: string | null,
): Promise<boolean> {
  const { phoneNumber, channelQuery, refresh, notify } = context;
  try {
    await fetchApi(
      `/api/conversations/${phoneNumber}/${action}${channelQuery}`,
      { method: "POST" },
    );
    await refresh();
  } catch (error) {
    notify.error(
      error instanceof Error ? error.message : "No se pudo completar la acción",
    );
    return false;
  }
  if (successMessage) notify.success(successMessage);
  return true;
}

export const takeOverConversation = (context: ConversationActionContext) =>
  post(context, "takeover", "Has tomado control de la conversación");

/** Accepting an assignment is a takeover by the agent it was assigned to. */
export const acceptAssignment = (context: ConversationActionContext) =>
  post(context, "takeover", "Asignación aceptada");

export const releaseConversation = (context: ConversationActionContext) =>
  post(context, "release", null);
