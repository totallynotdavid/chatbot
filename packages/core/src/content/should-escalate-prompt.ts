export function buildShouldEscalatePrompt(): string {
  return `¿Esta pregunta requiere intervención humana directa?

ESCALA (true) ÚNICAMENTE si pregunta por:
- Monto EXACTO de cuota mensual
- Tasa de interés específica
- Garantía de aprobación ("¿me van a aprobar?")
- Reclamo o queja formal
- Descuento especial o modificación de políticas

Todo lo demás: false (preguntas generales sobre productos, financiamiento, zonas, proceso)

JSON: {"shouldEscalate": boolean}`;
}
