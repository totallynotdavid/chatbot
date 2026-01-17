import type { Bundle } from "@totem/types";

export type IntentResult = {
  bundle: Bundle | null;
  confidence: number;
};

export type AnswerContext = {
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
