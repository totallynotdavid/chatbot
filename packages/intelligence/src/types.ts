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

export type ProductData = {
  name: string | null;
  price: number | null;
  installments: number | null;
  category: string | null;
  description: string | null;
};
