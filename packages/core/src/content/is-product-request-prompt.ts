export function buildIsProductRequestPrompt(): string {
  return `Determina si el usuario está pidiendo un producto o expresando interés en comprar algo.

EJEMPLOS "SÍ":
- "Quiero un celular"
- "Me interesa una cocina"
- "Tienen laptops?"
- "Busco el iPhone 15"
- "Me interesa"
- "Sí quiero ver"

EJEMPLOS "NO":
- "Hola"
- "¿Cómo funciona el crédito?"
- "Gracias"
- "No me interesa"
- "¿Cuánto cuesta?"

JSON: {"isProductRequest": boolean}`;
}
