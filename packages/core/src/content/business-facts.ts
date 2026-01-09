// Knowledge base used by LLM to answer customer questions
export const BUSINESS_FACTS = {
  warranty: {
    duration: "1 año",
    coverage: "defectos de fábrica",
    provider: "fabricante",
    exclusions: "daños por mal uso o accidentes",
  },

  delivery: {
    cost: "gratuito",
    time: "2-3 días hábiles después de firmado el contrato",
    coverage: ["Lima Metropolitana", "Callao"],
    process: "Coordinamos contigo fecha y hora de entrega",
    notes: "Entrega en la dirección que nos proporciones",
  },

  contract: {
    method: "llamada telefónica grabada",
    duration: "5-10 minutos aproximadamente",
    requirements: [
      "DNI físico a la mano",
      "Confirmar datos personales (nombre, DNI, dirección)",
      "Confirmar dirección de entrega completa con referencias",
    ],
    legal:
      "La grabación de la llamada tiene validez legal como contrato de compra",
    timing: "Un agente se contactará contigo en las próximas 2 horas",
    availability: "De lunes a sábado de 9am a 6pm",
  },

  payment: {
    method: "cuotas mensuales en tu recibo de Calidda",
    downPayment: "sin cuota inicial",
    terms: ["3 meses", "6 meses", "12 meses", "18 meses", "24 meses"],
    automatic:
      "El monto se descuenta automáticamente de tu recibo mensual de Calidda",
    notes: "Sin intereses adicionales, solo el valor del producto dividido",
  },

  returns: {
    period: "7 días calendario",
    condition: "solo si el producto llega con fallas de fábrica",
    process:
      "Llamar al mismo número de WhatsApp para coordinar recojo del producto",
    refund: "devolución del 100% del monto pagado",
    notes: "No aplica para cambio de opinión o arrepentimiento",
  },

  coverage: {
    zones: ["Lima Metropolitana", "Callao"],
    excluded: "No realizamos entregas fuera de Lima y Callao",
    distritos:
      "Entregamos en todos los distritos de Lima y Callao sin costo adicional",
  },

  company: {
    name: "Totem",
    partner: "Aliado comercial de Calidda",
    contact: "A través de este mismo número de WhatsApp",
    availability: "Lunes a sábado de 9am a 6pm",
  },
} as const;

export type BusinessFacts = typeof BUSINESS_FACTS;
