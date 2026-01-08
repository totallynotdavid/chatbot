import type { StateContext } from "@totem/core";
import type { Conversation } from "@totem/types";
import { checkGASO } from "../../../modules/eligibility/gaso.ts";
import { WhatsAppService } from "../../../services/whatsapp/index.ts";
import { updateConversationState, escalateConversation } from "../context.ts";
import { trackEvent } from "../../../services/analytics.ts";
import { notifyTeam } from "../../../services/notifier.ts";
import { selectVariant, formatFirstName } from "@totem/core";
import * as T from "@totem/core";

export async function handleCheckGaso(
  conv: Conversation,
  dni: string,
  context: StateContext,
): Promise<void> {
  const phoneNumber = conv.phone_number;
  const isSimulation = conv.is_simulation === 1;
  const result = await checkGASO(dni, phoneNumber);

  // Check if PowerBI is down and we used fallback
  if (
    !isSimulation &&
    (result.reason?.startsWith("powerbi_down") ||
      result.reason === "powerbi_failed_used_fallback")
  ) {
    await notifyTeam(
      "dev",
      `[ALERT] PowerBI is DOWN. Using Calidda fallback\n` +
        `Reason: ${result.reason}\n` +
        `DNI: ${dni}\n` +
        `Eligible: ${result.eligible}\n` +
        `Credit: S/ ${result.credit}\n` +
        `Phone: ${phoneNumber}`,
    );
  }

  if (!result.eligible) {
    // Check if it's an API error (provider unavailable)
    if (
      result.reason === "api_error" ||
      result.reason === "provider_unavailable" ||
      result.reason === "all_providers_down"
    ) {
      // Notify team and escalate
      if (!isSimulation) {
        await notifyTeam(
          "dev",
          `[ALERT] GASO Provider unavailable\nDNI: ${dni}\nReason: ${result.reason}\nPhone: ${phoneNumber}`,
        );
      }

      const { message: handoffMsg, updatedContext: variantCtx } =
        T.selectVariantWithContext(
          T.HANDOFF_TO_HUMAN,
          "HANDOFF_TO_HUMAN",
          context,
        );
      updateConversationState(phoneNumber, "ESCALATED", variantCtx);

      if (isSimulation) {
        WhatsAppService.logMessage(
          phoneNumber,
          "outbound",
          "text",
          handoffMsg,
          "sent",
        );
      } else {
        await WhatsAppService.sendMessage(phoneNumber, handoffMsg);
      }

      escalateConversation(phoneNumber, "gaso_provider_unavailable");
      trackEvent(phoneNumber, "provider_error", {
        provider: "gaso",
        reason: result.reason,
      });
      return;
    }

    // Not eligible in either system
    const { message: notEligibleMsg, updatedContext: variantCtx } =
      selectVariant(T.NOT_ELIGIBLE, "NOT_ELIGIBLE", context);
    updateConversationState(phoneNumber, "CLOSING", variantCtx);

    if (isSimulation) {
      WhatsAppService.logMessage(
        phoneNumber,
        "outbound",
        "text",
        notEligibleMsg,
        "sent",
      );
    } else {
      await WhatsAppService.sendMessage(phoneNumber, notEligibleMsg);
    }

    trackEvent(phoneNumber, "eligibility_failed", {
      reason: result.reason || "not_found",
    });
    return;
  }

  // Check Gaso eligibility matrix (need age first)
  const firstName = formatFirstName(result.name);
  const ageVariants = T.ASK_AGE(firstName);
  const { message: ageMsg, updatedContext: variantCtx } = selectVariant(
    ageVariants,
    "ASK_AGE",
    context,
  );

  updateConversationState(phoneNumber, "COLLECT_AGE", {
    segment: "gaso",
    clientName: result.name,
    creditLine: result.credit,
    nse: result.nse,
    ...variantCtx,
  });

  if (isSimulation) {
    WhatsAppService.logMessage(phoneNumber, "outbound", "text", ageMsg, "sent");
  } else {
    await WhatsAppService.sendMessage(phoneNumber, ageMsg);
  }
}
