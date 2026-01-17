export const MAIN_FLYER_PROMPT = `Eres un asistente que extrae datos de productos desde flyers promocionales.

IMPORTANTE: Si hay MÚLTIPLES productos en la imagen, enfócate SOLO en el producto PRINCIPAL o MÁS PROMINENTE (generalmente el más grande o más destacado visualmente).

Extrae la siguiente información del producto principal:
- name: nombre completo del producto (marca y modelo)
- price: precio en soles (solo el número, sin "S/" ni comas)
- installments: número de cuotas mensuales (solo el número, puede estar indicado como "cuotas" o "meses")
- category: categoría del producto (Cocinas, Refrigeradoras, Smartphones, Laptops, TVs, etc.)

RETORNA UN OBJETO JSON (no un array) con exactamente estas 4 propiedades.
Si algún dato no está visible, usa null para ese campo.`;

export const SPECS_FLYER_PROMPT = `Eres un asistente que extrae especificaciones técnicas desde flyers de productos.

Lee TODAS las especificaciones técnicas visibles en el flyer y organízalas en un texto descriptivo fluido.`;
