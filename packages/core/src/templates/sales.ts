// Sales-focused message variations with natural Peruvian Spanish
// Variations maintain enthusiasm without sounding pushy

export const FNB_APPROVED = (name: string, credit: number) => [
    `¡Excelente noticia, ${name}! Tienes una línea de crédito aprobada de S/ ${credit.toFixed(2)}. Tenemos celulares, laptops, televisores, electrodomésticos y más. ¿Qué tipo de producto te interesa?`,
    `${name}, ¡tengo buenas noticias! Tu crédito aprobado es de S/ ${credit.toFixed(2)}. ¿Qué producto te gustaría ver? Tenemos de todo: celulares, laptops, TVs, cocinas...`,
    `Perfecto ${name}, calificas con S/ ${credit.toFixed(2)} de línea. Tenemos celulares, laptops, televisores y más. ¿Qué buscas?`,
    `¡Genial ${name}! Tienes S/ ${credit.toFixed(2)} disponibles. ¿Te interesan celulares, laptops, electrodomésticos...?`,
];

export const GASO_OFFER_KITCHEN_BUNDLE = [
    `Excelente, calificas para nuestro programa de financiamiento.\n\nNuestro combo especial incluye: cocina + electrodomésticos con cuotas desde S/ 80 mensuales (hasta 18 meses).\n\n💡 *¿Por qué cocina?* Es un requisito de nuestro financista para darte las mejores tasas. Pero no te preocupes, puedes elegir el modelo que más te guste.\n\n¿Te gustaría conocer las opciones disponibles?`,
    `Perfecto, calificas para el programa.\n\nCombo disponible: cocina + otros electrodomésticos desde S/ 80 al mes (hasta 18 meses).\n\nLa cocina es parte del requisito de Cálidda para darte buenas tasas, pero hay varios modelos.\n\n¿Quieres ver las opciones?`,
    `Genial, estás aprobado.\n\nTenemos un combo cocina + electrodomésticos con cuotas desde S/ 80 mensuales (18 meses máximo).\n\nEl requisito de incluir cocina viene de Cálidda para ofrecerte mejores condiciones.\n\n¿Te muestro qué hay disponible?`,
];

export const KITCHEN_OBJECTION_RESPONSE = [
    `Entiendo tu preferencia. Te comento que el combo con cocina es un requisito financiero de Cálidda para acceder a las mejores tasas. Las cuotas son accesibles y puedes financiar hasta 18 meses. ¿Quieres que te muestre las opciones disponibles?`,
    `Te entiendo. El tema es que Cálidda requiere incluir la cocina para aprobar el financiamiento con buenas tasas. Hay modelos variados y las cuotas son cómodas (hasta 18 meses). ¿Las vemos?`,
    `Claro, entiendo. La cocina es requisito de Cálidda para dar el crédito, pero con cuotas flexibles hasta 18 meses. ¿Te gustaría ver qué modelos hay?`,
];

export const THERMA_ALTERNATIVE = [
    `Como alternativa, también tenemos combos con termas. ¿Te interesaría explorar esa opción?`,
    `Si prefieres, también hay combos con terma en lugar de cocina. ¿Quieres verlos?`,
    `Otra opción: combos con terma. ¿Te llama más la atención?`,
];

export const OFFER_PRODUCTS = (category: string) => [
    `Perfecto, aquí están nuestras mejores opciones en ${category}:`,
    `Dale, te muestro lo mejor en ${category}:`,
    `Mira estas opciones en ${category}:`,
];

export const ASK_PRODUCT_INTEREST = [
    `¿Qué producto te gustaría conocer? Tenemos celulares, cocinas, laptops, refrigeradoras, televisores y más.`,
    `¿Qué te llama la atención? Celulares, laptops, TVs, cocinas, refrigeradoras...`,
    `¿En qué producto estás pensando? Tenemos celulares, laptops, electrodomésticos...`,
];

export const CONFIRM_PURCHASE = [
    `¡Excelente! Un asesor se comunicará contigo pronto para coordinar todo.`,
    `Perfecto, te contactamos pronto para coordinar la entrega.`,
    `¡Genial! Un asesor te llamará para finalizar.`,
];

export const ASK_FOR_SPECS = [
    `Si necesitas más detalles técnicos de algún producto, solo pregúntame. ¿Cuál te interesa más?`,
    `¿Quieres saber especificaciones de alguno? Pregúntame lo que necesites.`,
    `Si tienes dudas de algún producto, pregúntame nomás.`,
];

export const INSTALLMENTS_INFO = (
    installments: number,
    monthlyPayment: number,
) => [
        `Este producto se puede pagar en ${installments} cuotas mensuales de aproximadamente S/ ${monthlyPayment.toFixed(2)} cada una.`,
        `Puedes pagarlo en ${installments} meses, alrededor de S/ ${monthlyPayment.toFixed(2)} por mes.`,
        `Lo pagas en ${installments} cuotas de S/ ${monthlyPayment.toFixed(2)} mensuales.`,
    ];

export const PRICE_CONCERN = {
    standard: [
        `Entiendo. Lo bueno es que puedes pagarlo con financiamiento en cuotas mensuales que salen directo en tu recibo de Calidda. ¿Qué producto te llama la atención?`,
        `Claro, por eso está el financiamiento. Pagas en cuotas por tu recibo de Calidda. ¿Cuál producto te gusta?`,
        `Te entiendo. Las cuotas mensuales salen en tu recibo de Calidda para hacerlo más cómodo. ¿Qué buscas?`,
    ],
    empathetic: [
        `Totalmente entendible. Por eso ofrecemos el financiamiento en cuotas que se suman a tu recibo de Calidda para que sea más accesible. ¿Qué producto te interesa?`,
        `Te entiendo perfectamente. Las cuotas mensuales hacen que sea más manejable, y salen directo en tu recibo. ¿Cuál te gustaría conocer?`,
        `Sí, entiendo tu preocupación. El financiamiento ayuda a distribuir el pago en cuotas cómodas. ¿Qué buscas?`,
    ],
};

export const OUT_OF_CATALOG_REQUEST = [
    `Ese producto específico no lo tengo en el catálogo ahora, pero déjame verificar si podemos conseguirlo.`,
    `No tengo ese modelo exacto aquí, pero puedo consultar si lo conseguimos. Dame un momento.`,
    `Ese no lo veo disponible ahora mismo. Déjame revisar qué podemos hacer.`,
];

export const CREDIT_EXCEEDED = [
    `Ese producto supera tu línea actual, pero déjame verificar si hay opciones especiales.`,
    `El monto de ese excede tu crédito disponible. Déjame consultar alternativas.`,
    `Está un poco por encima de tu línea. Dame un momento para revisar opciones.`,
];
