export type QuestionType =
  | "product_inquiry" // "Tienen Galaxy A25?"
  | "product_specs" // "Cuántas pulgadas tiene?"
  | "price_inquiry" // "Cuánto cuesta?"
  | "delivery" // "Cuándo llega?"
  | "warranty" // "Tiene garantía?"
  | "payment" // "Cómo se paga?"
  | "contract" // "Cómo firmo?"
  | "returns" // "Puedo devolver?"
  | "coverage" // "Entregan en Miraflores?"
  | "general"; // Unclear or multiple topics

export function buildClassifyQuestionPrompt(): string {
  return `Classify the customer question into ONE category.

Categories:
- product_inquiry: Asking if specific product exists or is available
- product_specs: Asking about product specifications (size, memory, features)
- price_inquiry: Asking about price of products
- delivery: Questions about shipping, delivery time, when it arrives
- warranty: Questions about guarantee, warranty coverage
- payment: How to pay, installments, payment methods
- contract: How to sign, contract process, recording
- returns: Refunds, returns, exchanges
- coverage: Delivery zones, areas covered
- general: Unclear, multiple topics, or doesn't fit above

Reply with JSON: {"type": "category_name", "confidence": "high|medium|low"}`;
}
