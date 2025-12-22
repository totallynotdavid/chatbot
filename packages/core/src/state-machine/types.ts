import type { ConversationState, Segment } from "@totem/types";

export type Command =
    | { type: "CHECK_FNB"; dni: string }
    | { type: "CHECK_GASO"; dni: string }
    | { type: "SEND_MESSAGE"; content: string }
    | { type: "SEND_IMAGES"; productIds: string[]; category: string }
    | { type: "NOTIFY_TEAM"; channel: "agent" | "dev" | "sales"; message: string }
    | { type: "TRACK_EVENT"; eventType: string; metadata: Record<string, any> }
    | { type: "ESCALATE"; reason: string };

export type StateContext = {
    phoneNumber: string;
    dni?: string;
    clientName?: string;
    segment?: Segment;
    creditLine?: number;
    nse?: number;
    age?: number;
    maxInstallments?: number;
    isCaliddaClient?: boolean;
    offeredCategory?: string;
    objectionCount?: number;
    cantProvideCount?: number;
    askedToWait?: boolean;
    lastInterestCategory?: string;
    sessionStartedAt?: string;
    waitingMessageCount?: number;
    purchaseConfirmed?: boolean;
    llmDetectedQuestion?: boolean;
    llmGeneratedAnswer?: string;
    llmRequiresHuman?: boolean;
    llmExtractedCategory?: string;
    llmObjectionIntensity?: "mild" | "strong";
};

export type StateOutput = {
    nextState: ConversationState;
    commands: Command[];
    updatedContext: Partial<StateContext>;
};

export type TransitionInput = {
    currentState: ConversationState;
    message: string;
    context: StateContext;
};
