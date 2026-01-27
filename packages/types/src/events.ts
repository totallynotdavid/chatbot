export type BaseEvent = {
  traceId: string;
  timestamp: number;
};

export type DomainEvent =
  | (BaseEvent & {
      type: "agent_assigned";
      payload: {
        phoneNumber: string;
        agentId: string;
        agentPhone: string | null;
        clientName: string | null;
      };
    })
  | (BaseEvent & {
      type: "eligibility_failed";
      payload: {
        phoneNumber: string;
        dni: string;
        reason: string;
        segment?: string;
      };
    })
  | (BaseEvent & {
      type: "purchase_confirmed";
      payload: {
        amount: number;
        clientName: string;
        phoneNumber: string;
        dni: string;
        productId: string;
        productName: string;
      };
    })
  | (BaseEvent & {
      type: "order_created";
      payload: {
        orderId: string;
        orderNumber: string;
        amount: number;
        clientName: string;
        phoneNumber: string;
      };
    })
  | (BaseEvent & {
      type: "system_outage_reported";
      payload: {
        source: "core" | "external";
        details: string[];
      };
    })
  | (BaseEvent & {
      type: "system_outage_detected";
      payload: {
        dni: string;
        errors: string[];
        timestamp: number;
      };
    })
  | (BaseEvent & {
      type: "provider_degraded";
      payload: {
        failedProvider: string;
        workingProvider: string;
        dni: string;
        errors: string[];
      };
    })
  | (BaseEvent & {
      type: "escalation_triggered";
      payload: {
        reason: string;
        phoneNumber: string;
        context?: Record<string, unknown>;
      };
    })
  | (BaseEvent & {
      type: "enrichment_limit_exceeded";
      payload: {
        phoneNumber: string;
        lastPhase: string;
      };
    })
  | (BaseEvent & {
      type: "system_error_occurred";
      payload: {
        phoneNumber: string;
        error: string;
        context?: Record<string, unknown>;
      };
    })
  | (BaseEvent & {
      type: "attention_required";
      payload: {
        phoneNumber: string;
        reason: string;
        clientName: string;
        dni: string;
      };
    });
