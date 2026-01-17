import type { Segment, Bundle, CategoryGroup } from "@totem/types";

export type ConversationPhase =
  | { phase: "greeting" }
  | { phase: "confirming_client" }
  | { phase: "collecting_dni" }
  | { phase: "checking_eligibility"; dni: string }
  | { phase: "offering_dni_retry" }
  | {
      phase: "collecting_age";
      dni: string;
      name: string;
      credit?: number;
      affordableCategories?: string[];
      affordableBundles?: Bundle[];
      categoryDisplayNames?: string[];
    }
  | {
      phase: "offering_products";
      segment: Segment;
      credit: number;
      name: string;
      availableCategories?: string[];
      affordableBundles?: Bundle[];
      categoryDisplayNames?: string[];
      currentGroup?: CategoryGroup;
      exploringGroup?: boolean;
      lastShownCategory?: string;
      sentProducts?: Array<{
        name: string;
        position: number;
        productId?: string;
        price?: number;
      }>;
      interestedProduct?: {
        name: string;
        price: number;
        productId: string;
        exploredCategoriesCount: number;
      };
      lastAction?: {
        type: "showed_products";
        category: string;
        productCount: number;
        timestamp: number;
      };
    }
  | {
      phase: "confirming_selection";
      segment: Segment;
      credit: number;
      name: string;
      selectedProduct: {
        name: string;
        price: number;
        productId: string;
      };
    }
  | {
      phase: "handling_objection";
      segment: Segment;
      credit: number;
      name: string;
      objectionCount: number;
      sentProducts?: Array<{
        name: string;
        position: number;
        productId?: string;
        price?: number;
      }>;
    }
  | {
      phase: "closing";
      purchaseConfirmed: boolean;
      subPhase?: "just_confirmed" | "post_sale_support";
    }
  | { phase: "escalated"; reason: string };

export type ConversationMetadata = {
  dni?: string;
  name?: string;
  segment?: Segment;
  credit?: number;
  nse?: number;
  age?: number;
  lastCategory?: string;
  isReturningUser?: boolean;
  triedDnis?: string[];
  createdAt: number;
  lastActivityAt: number;
};

export type EnrichmentRequest =
  | { type: "check_eligibility"; dni: string }
  | { type: "detect_question"; message: string }
  | { type: "should_escalate"; message: string }
  | { type: "is_product_request"; message: string }
  | {
      type: "extract_bundle_intent";
      message: string;
      affordableBundles: Bundle[];
    }
  | {
      type: "answer_question";
      message: string;
      context: {
        segment?: Segment;
        credit?: number;
        phase: string;
        availableCategories: string[];
      };
    }
  | {
      type: "generate_backlog_apology";
      message: string;
      ageMinutes: number;
    }
  | {
      type: "recover_unclear_response";
      message: string;
      context: {
        phase: string;
        lastQuestion?: string;
        expectedOptions?: string[];
      };
    };

export type EnrichmentResult =
  | {
      type: "eligibility_result";
      status: "eligible" | "not_eligible" | "needs_human";
      segment?: Segment;
      credit?: number;
      name?: string;
      nse?: number;
      requiresAge?: boolean;
      handoffReason?: string;
      affordableCategories?: string[];
      affordableBundles?: Bundle[];
      categoryDisplayNames?: string[];
      groupDisplayNames?: string[];
    }
  | { type: "question_detected"; isQuestion: boolean }
  | { type: "escalation_needed"; shouldEscalate: boolean }
  | { type: "product_request_detected"; isProductRequest: boolean }
  | {
      type: "bundle_intent_extracted";
      bundle: Bundle | null;
      confidence: number;
    }
  | { type: "question_answered"; answer: string }
  | {
      type: "backlog_apology";
      apology: string;
    }
  | { type: "recovery_response"; text: string };

export type Command =
  | { type: "SEND_MESSAGE"; text: string }
  | { type: "SEND_IMAGES"; category: string }
  | { type: "SEND_BUNDLE"; bundleId: string }
  | { type: "TRACK_EVENT"; event: string; metadata?: Record<string, unknown> }
  | { type: "NOTIFY_TEAM"; channel: "agent" | "dev" | "sales"; message: string }
  | { type: "ESCALATE"; reason: string };

export type TransitionResult =
  | {
      type: "update";
      nextPhase: ConversationPhase;
      commands: Command[];
    }
  | {
      type: "need_enrichment";
      enrichment: EnrichmentRequest;
      pendingPhase?: ConversationPhase;
    };

export type TransitionInput = {
  phase: ConversationPhase;
  message: string;
  metadata: ConversationMetadata;
  enrichment?: EnrichmentResult;
  quotedContext?: {
    id: string;
    body: string;
    type: string;
    timestamp: number;
  };
};
