import type { DomainEvent } from "@totem/types";
import { templates } from "./templates.ts";

export type NotificationRule = {
  id: string;
  triggerEvent: DomainEvent["type"];
  channel: "whatsapp";
  target: string | ((event: DomainEvent) => string | undefined);
  condition: (event: DomainEvent) => boolean;
  template: (event: DomainEvent) => string;
};

export const notificationRules: NotificationRule[] = [
  {
    id: "agent_assignment_whatsapp",
    triggerEvent: "agent_assigned",
    channel: "whatsapp",
    target: (event) => {
      if (event.type !== "agent_assigned") return undefined;
      return event.payload.agentPhone || undefined;
    },
    condition: (event) => {
      if (event.type !== "agent_assigned") return false;
      return !!event.payload.agentPhone;
    },
    template: (event) => {
      if (event.type !== "agent_assigned") return "";
      return templates.assignment({
        phoneNumber: event.payload.phoneNumber,
        clientName: event.payload.clientName,
        dni: event.payload.dni,
      });
    },
  },
  {
    id: "enrichment_limit_alert",
    triggerEvent: "enrichment_limit_exceeded",
    channel: "whatsapp",
    target: "dev",
    condition: (event) => event.type === "enrichment_limit_exceeded",
    template: (event) => {
      if (event.type !== "enrichment_limit_exceeded") return "";
      return templates.enrichmentLoop({
        phoneNumber: event.payload.phoneNumber,
      });
    },
  },
  {
    id: "contract_uploaded_alert",
    triggerEvent: "contract_uploaded",
    channel: "whatsapp",
    target: "sales",
    condition: (event) => event.type === "contract_uploaded",
    template: (event) => {
      if (event.type !== "contract_uploaded") return "";
      return templates.contractUploaded({
        phoneNumber: event.payload.phoneNumber,
        clientName: event.payload.clientName,
        details: event.payload.contractPath,
      });
    },
  },
  {
    id: "new_order_alert",
    triggerEvent: "order_created",
    channel: "whatsapp",
    target: "agent",
    condition: (event) => event.type === "order_created",
    template: (event) => {
      if (event.type !== "order_created") return "";
      return templates.newOrder(
        {
          phoneNumber: event.payload.phoneNumber,
          clientName: event.payload.clientName || "Cliente",
          dni: event.payload.dni,
          urlSuffix: `/orders/${event.payload.orderId}`,
        },
        event.payload.orderNumber,
        event.payload.amount,
        event.payload.productName,
      );
    },
  },
  {
    id: "escalation_alert",
    triggerEvent: "escalation_triggered",
    channel: "whatsapp",
    target: "agent",
    condition: (event) => event.type === "escalation_triggered",
    template: (event) => {
      if (event.type !== "escalation_triggered") return "";
      let reason = event.payload.reason;

      const map: Record<string, string> = {
        customer_question_during_objection:
          "Pregunta durante manejo de objeción",
        multiple_objections: "Cliente rechazó múltiples ofertas",
        customer_question_requires_human:
          "Pregunta del cliente requiere atención humana",
      };

      if (map[reason]) {
        reason = map[reason]!;
      }

      return templates.escalation(
        { phoneNumber: event.payload.phoneNumber },
        reason,
      );
    },
  },
  {
    id: "system_error_alert",
    triggerEvent: "system_error_occurred",
    channel: "whatsapp",
    target: "dev",
    condition: (event) => event.type === "system_error_occurred",
    template: (event) => {
      if (event.type !== "system_error_occurred") return "";
      return templates.systemError(
        { phoneNumber: event.payload.phoneNumber },
        event.payload.error,
      );
    },
  },
  {
    id: "attention_required_alert",
    triggerEvent: "attention_required",
    channel: "whatsapp",
    target: "agent",
    condition: (event) => event.type === "attention_required",
    template: (event) => {
      if (event.type !== "attention_required") return "";
      return templates.attention({
        phoneNumber: event.payload.phoneNumber,
        clientName: event.payload.clientName,
        dni: event.payload.dni,
      });
    },
  },
  {
    id: "system_outage_alert",
    triggerEvent: "system_outage_detected",
    channel: "whatsapp",
    target: "dev",
    condition: (event) => event.type === "system_outage_detected",
    template: (event) => {
      if (event.type !== "system_outage_detected") return "";
      return templates.systemOutage(
        { phoneNumber: "N/A", dni: event.payload.dni },
        event.payload.errors,
      );
    },
  },
  {
    id: "provider_degraded_alert",
    triggerEvent: "provider_degraded",
    channel: "whatsapp",
    target: "dev",
    condition: () => true,
    template: (event) => {
      if (event.type !== "provider_degraded") return "";
      return templates.degradation(
        { phoneNumber: "N/A", dni: event.payload.dni },
        event.payload.failedProvider,
        event.payload.workingProvider,
      );
    },
  },
];
