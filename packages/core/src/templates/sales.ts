export const FNB_APPROVED = (name: string, credit: number) => [
  `¡Excelente noticia, ${name}! 🎉 Tienes una línea de crédito aprobada de S/ ${credit.toFixed(2)}. Tenemos celulares, laptops, televisores, electrodomésticos y más. ¿Qué te gustaría ver?`,
  `${name}, ¡buenas noticias! 😊 Tu crédito aprobado es de S/ ${credit.toFixed(2)}. ¿Qué producto te gustaría conocer? Tenemos de todo: celulares, laptops, TVs, cocinas...`,
  `Perfecto ${name} 🎉 Calificas con S/ ${credit.toFixed(2)} de línea. Tenemos celulares, laptops, televisores y más. ¿Qué buscas?`,
  `¡Genial ${name}! Tienes S/ ${credit.toFixed(2)} disponibles. ¿Te interesan celulares, laptops, electrodomésticos...?`,
];

export const GASO_OFFER_KITCHEN_BUNDLE = [
  `¡Excelente noticia, calificas para nuestro programa! 🎉\\n\\nTenemos combos de cocina + electrodomésticos desde S/ 80 al mes (hasta 18 meses). Sé que quizás no necesites cocina, pero es requisito del financiamiento para que tengas mejores tasas. Hay varios modelos disponibles.\\n\\n¿Quieres ver las opciones?`,
  `Perfecto, estás aprobado 😊 Tenemos combos cocina + electrodomésticos con cuotas desde S/ 80 mensuales (18 meses máximo).\\n\\nLa cocina es requisito para darte buenas condiciones de financiamiento, pero puedes elegir el modelo que más te guste.\\n\\n¿Te muestro qué hay disponible?`,
  `Genial, calificas para el programa. Combo disponible: cocina + electrodomésticos desde S/ 80 al mes (hasta 18 meses).\\n\\nEl requisito de incluir cocina es para ofrecerte mejores tasas, pero hay varios modelos.\\n\\n¿Quieres conocerlos?`,
];

export const KITCHEN_OBJECTION_RESPONSE = [
  "Entiendo totalmente. El tema es que sin la cocina no se aprueba el financiamiento, pero hay opciones variadas y las cuotas son cómodas (hasta 18 meses). ¿Las vemos? 😊",
  "Te entiendo. Lamentablemente es requisito incluir la cocina para que te den el crédito, pero con cuotas flexibles hasta 18 meses. ¿Te gustaría ver qué modelos hay?",
  "Claro, sé que quizás no la necesites. Pero se requiere la cocina para aprobar el financiamiento con buenas tasas. Hay varios modelos. ¿Los revisamos?",
];

export const THERMA_ALTERNATIVE = [
  "Como alternativa, también tenemos combos con termas. ¿Te interesaría explorar esa opción? 😊",
  "Si prefieres, también hay combos con terma en lugar de cocina. ¿Quieres verlos?",
  "Otra opción: combos con terma. ¿Te llama más la atención?",
];

export const ASK_PRODUCT_INTEREST = [
  "¿Qué producto te gustaría conocer? 😊 Tenemos celulares, cocinas, refrigeradoras, televisores, termas...",
  "¿Qué te llama la atención? Celulares, TVs, cocinas, refrigeradoras, termas...",
  "¿En qué estás pensando? Tenemos celulares, electrodomésticos, TVs...",
];

export const CONFIRM_PURCHASE = (name: string) => [
  `¡Excelente, ${name}! 🎉 En unos minutos mi compañero te llamará a este número para realizar el contrato.`,
  `Perfecto ${name} 😊 Te llamamos en breve a este número para finalizar los detalles del contrato.`,
  `¡Genial, ${name}! 🎉 Te contacto pronto para coordinar el contrato por teléfono.`,
];

export const PRICE_CONCERN = {
  standard: [
    "Te entiendo 😊 Por eso está el financiamiento en cuotas que salen en tu recibo de Cálidda para hacerlo más cómodo. ¿Qué producto te interesa?",
    "Claro, por eso las cuotas mensuales ayudan. Se cobran directo en tu recibo de Cálidda. ¿Cuál te gusta?",
    "Entiendo. Lo bueno es que puedes pagarlo en cuotas por tu recibo de Cálidda. ¿Qué buscas?",
  ],
  empathetic: [
    "Totalmente entendible 😊 Por eso ofrecemos el financiamiento en cuotas que se suman a tu recibo de Cálidda para que sea más accesible. ¿Qué producto te interesa?",
    "Te entiendo perfectamente. Las cuotas mensuales hacen que sea más manejable, y salen directo en tu recibo. ¿Cuál te gustaría conocer?",
    "Sí, entiendo tu preocupación. El financiamiento ayuda a distribuir el pago en cuotas cómodas. ¿Qué buscas?",
  ],
};
