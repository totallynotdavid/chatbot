export type AnswerContext = {
  businessName: string;
  segment?: string;
  creditLine?: number;
  phase: string;
  availableCategories: string[];
};

export type RecoveryContext = {
  phase: string;
  lastQuestion?: string;
  expectedOptions?: string[];
};
