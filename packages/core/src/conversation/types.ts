import type { Segment } from "@totem/types";

export type ConversationPhase =
  | { phase: "greeting" }
  | { phase: "confirming_client" }
  | { phase: "collecting_dni" }
  | { phase: "checking_eligibility"; dni: string }
  | { phase: "collecting_age"; dni: string; name: string }
  | {
      phase: "offering_products";
      segment: Segment;
      credit: number;
      name: string;
      availableCategories?: string[];
    }
  | {
      phase: "handling_objection";
      segment: Segment;
      credit: number;
      name: string;
      objectionCount: number;
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
  createdAt: number;
  lastActivityAt: number;
};

export type EnrichmentRequest =
  | { type: "check_eligibility"; dni: string }
  | { type: "fetch_categories"; segment: Segment }
  | { type: "detect_question"; message: string }
  | { type: "should_escalate"; message: string }
  | {
      type: "extract_category";
      message: string;
      availableCategories: string[];
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
    };

/**
 * Enrichment results
 */
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
    }
  | { type: "categories_fetched"; categories: string[] }
  | { type: "question_detected"; isQuestion: boolean }
  | { type: "escalation_needed"; shouldEscalate: boolean }
  | { type: "category_extracted"; category: string | null }
  | { type: "question_answered"; answer: string }
  | { type: "backlog_apology"; apology: string };

export type TransitionResult =
  | {
      type: "stay";
      response?: string;
      track?: TrackEvent;
    }
  | {
      type: "advance";
      nextPhase: ConversationPhase;
      response?: string;
      images?: ImageCommand;
      track?: TrackEvent;
      notify?: NotifyCommand;
    }
  | {
      type: "need_enrichment";
      enrichment: EnrichmentRequest;
      pendingPhase?: ConversationPhase;
    }
  | {
      type: "escalate";
      reason: string;
      response?: string;
      notify?: NotifyCommand;
    };

export type TrackEvent = {
  eventType: string;
  metadata?: Record<string, unknown>;
};

export type ImageCommand = {
  category: string;
  productIds?: string[];
};

export type NotifyCommand = {
  channel: "agent" | "dev" | "sales";
  message: string;
};

export type TransitionInput = {
  phase: ConversationPhase;
  message: string;
  metadata: ConversationMetadata;
  enrichment?: EnrichmentResult;
};
