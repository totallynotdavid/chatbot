import type { DomainEvent } from "@totem/types";
import { templates } from "./templates.ts";

export type NotificationRule = {
  id: string;
  triggerEvent: DomainEvent["type"];
  channel: "whatsapp" | "slack" | "email";
  target: string;
  condition: (event: DomainEvent) => boolean;
  template: (event: DomainEvent) => string;
};

export const notificationRules: NotificationRule[] = [
  {
    id: "agent_assignment_whatsapp",
    triggerEvent: "agent_assigned",
    channel: "whatsapp",
    target: "dynamic_agent",
    condition: (event) => {
      if (event.type !== "agent_assigned") return false;
      return !!event.payload.agentPhone;
    },
    template: (event) => {
      if (event.type !== "agent_assigned") return "";
      return templates.assignment({
        phoneNumber: event.payload.phoneNumber,
        clientName: event.payload.clientName,
        urlSuffix: `/conversations/${event.payload.phoneNumber}`,
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
      return templates.generic(
        { phoneNumber: event.payload.phoneNumber },
        `Límite de bucles de enriquecimiento excedido en conversación`,
      );
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
          urlSuffix: `/orders/${event.payload.orderId}`,
        },
        event.payload.orderNumber,
        event.payload.amount,
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
      let message = "";
      switch (event.payload.reason) {
        case "customer_question_during_objection":
          message = "Pregunta durante manejo de objeción";
          break;
        case "multiple_objections":
          message = "Cliente rechazó múltiples ofertas";
          break;
        case "customer_question_requires_human":
          message = "Pregunta del cliente requiere atención humana";
          break;
        default:
          message = `Escalamiento: ${event.payload.reason}`;
      }
      return templates.generic(
        { phoneNumber: event.payload.phoneNumber },
        message,
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
      return templates.generic(
        { phoneNumber: event.payload.phoneNumber },
        `Error del Sistema: ${event.payload.error}`,
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
      return templates.generic(
        {
          phoneNumber: event.payload.phoneNumber,
          clientName: event.payload.clientName,
        },
        `${event.payload.reason}. Revisa la conversación.`,
      );
    },
  },
];
