// Human-like message variations to avoid robotic repetition
// Each template has 3-5 variants that rotate per conversation session

export const GREETING = [
    "¡Hola! Somos Tótem, aliados de Cálidda. ¿Eres el titular de tu servicio Cálidda?",
    "Hola, te escribe Tótem. Trabajamos con Cálidda. ¿El servicio de gas está a tu nombre?",
    "¡Qué tal! Soy de Tótem, aliado de Cálidda. ¿Tú eres el titular de la cuenta de gas?",
    "Hola, soy de Tótem, trabajamos con Cálidda. ¿Tienes el servicio de gas a tu nombre?",
];

export const GREETING_RETURNING = (category: string) => [
    `¡Hola de nuevo! Veo que anteriormente te interesaron nuestros ${category}. ¿Quieres continuar donde lo dejamos?`,
    `Hola otra vez. La última vez preguntaste por ${category}. ¿Seguimos con eso?`,
    `¡Qué bueno verte de nuevo! ¿Todavía te interesan los ${category}?`,
];

export const CONFIRM_CLIENT_YES = [
    "Perfecto. ¿Me das tu número de DNI? (8 dígitos)",
    "Genial. Por favor, indícame tu DNI para verificar tus beneficios.",
    "Excelente. Necesito tu DNI para consultar tu línea de crédito.",
    "Dale. ¿Cuál es tu número de DNI?",
];

export const CONFIRM_CLIENT_NO = [
    "Entiendo. Por el momento solo atendemos a clientes de Cálidda con servicio activo. ¡Gracias por tu interés!",
    "Te agradezco el interés. Actualmente trabajamos solo con clientes de Cálidda. ¡Hasta pronto!",
    "Gracias por escribir. En este momento atendemos únicamente a clientes con servicio Cálidda activo.",
];

export const INVALID_DNI = [
    "El DNI debe tener exactamente 8 dígitos numéricos. Por favor, inténtalo nuevamente.",
    "Necesito un DNI de 8 dígitos. ¿Podrías verificarlo?",
    "Parece que falta algún dígito. El DNI tiene 8 números.",
];

// Categorized variants for context-aware selection
export const CHECKING_SYSTEM = {
    standard: [
        "Estoy revisando tu información con Cálidda, dame un momento.",
        "Déjame consultar esto con Cálidda.",
        "Un momento mientras reviso con Cálidda.",
    ],
    patient: [
        "Ya casi termino de revisar tu información con Cálidda. Dame un segundo más.",
        "Gracias por la espera. Estoy terminando la consulta con Cálidda.",
        "Casi listo. Estoy esperando la respuesta de Cálidda.",
    ],
    empathetic: [
        "Entiendo que quieres avanzar rápido. Estoy en ello, dame un momento.",
        "Sé que estás esperando. Estoy consultando con Cálidda ahora mismo.",
        "Ya casi. Estoy terminando de verificar tu info con Cálidda.",
    ],
};

export const NOT_ELIGIBLE = [
    "Lamentablemente, en este momento no podemos ofrecerte nuestros productos según nuestras políticas internas. Gracias por tu comprensión.",
    "Disculpa, por ahora no podemos proceder con tu solicitud según nuestras políticas. Gracias por tu comprensión.",
    "Gracias por tu interés. Actualmente no podemos ofrecerte el servicio según nuestras políticas internas.",
];

export const ASK_AGE = (name: string) => [
    `Hola ${name}, para continuar con tu solicitud, ¿cuántos años tienes?`,
    `${name}, necesito confirmar tu edad. ¿Cuántos años tienes?`,
    `Perfecto ${name}. ¿Me confirmas tu edad?`,
];

export const INVALID_AGE = [
    "Por favor, indícame tu edad en números (ejemplo: 35).",
    "Necesito tu edad en números. ¿Cuántos años tienes?",
    "Escribe tu edad solo con números, por favor.",
];

export const AGE_TOO_LOW = (minAge: number) => [
    `Para acceder a este beneficio, debes tener al menos ${minAge} años según las políticas de Cálidda.`,
    `Disculpa, la política de Cálidda requiere tener mínimo ${minAge} años para este servicio.`,
    `Según las políticas de Cálidda, necesitas tener ${minAge} años o más.`,
];

export const UNCLEAR_RESPONSE = [
    "Disculpa, no entendí bien. ¿Podrías explicarlo de nuevo?",
    "No logré entender. ¿Podrías decirlo de otra forma?",
    "Perdón, no capté eso. ¿Me lo explicas nuevamente?",
];

export const ASK_CLARIFICATION = [
    "¿Podrías ser más específico? Por ejemplo: celular, cocina, laptop, etc.",
    "¿Qué tipo de producto buscas? Tenemos celulares, cocinas, laptops, refrigeradoras...",
    "¿En qué producto estás pensando? Celular, laptop, TV, cocina...",
];

export const NO_STOCK = [
    "Lo siento, actualmente no tenemos disponibilidad en esa categoría. ¿Te interesa algo más?",
    "Disculpa, por ahora no tenemos stock en eso. ¿Quieres ver otras opciones?",
    "Ahora mismo no tenemos esa categoría disponible. ¿Te gustaría ver algo diferente?",
];

// Silent escalation - don't mention "asesor" explicitly
export const HANDOFF_TO_HUMAN = {
    standard: [
        "Dame un momento para verificar eso contigo.",
        "Déjame revisar tu caso con más detalle.",
        "Permíteme un momento para consultar.",
    ],
    empathetic: [
        "Entiendo tu situación. Déjame revisar esto con alguien que pueda ayudarte mejor.",
        "Veo que necesitas ayuda específica. Permíteme un momento para conseguir mejor asistencia.",
        "Ok, déjame conectarte con alguien que pueda resolver esto mejor.",
    ],
};

export const SESSION_TIMEOUT_CLOSING = [
    "Noto que ha pasado un tiempo. Si necesitas algo más, no dudes en escribirme nuevamente. ¡Hasta pronto!",
    "Veo que pasó un rato. Cuando quieras retomar, aquí estaré. ¡Saludos!",
    "Ha pasado un tiempo. Si regresas, con gusto te atiendo. ¡Hasta luego!",
];

export const IMAGE_REJECTED = [
    "Por tu seguridad y privacidad, solo aceptamos información por texto escrito. Por favor, escribe tu DNI (8 dígitos).",
    "Por seguridad, necesito que escribas tu DNI (8 dígitos) en lugar de enviarlo en imagen.",
    "Para proteger tu información, escribe tu DNI como texto (8 dígitos).",
];

export const NON_TEXT_REJECTED = [
    "En este momento solo puedo procesar mensajes de texto. ¿En qué puedo ayudarte?",
    "Por ahora solo leo mensajes de texto. ¿Qué necesitas?",
    "Manejo solo texto por el momento. ¿Qué consulta tienes?",
];

export const DNI_NOT_AVAILABLE = [
    "Entiendo. Puedo esperar mientras lo buscas, o si prefieres, un asesor puede contactarte más tarde. ¿Qué prefieres?",
    "Sin problema. ¿Buscas tu DNI o prefieres que te contactemos después?",
    "Tranquilo. ¿Lo buscas ahora o te llamo más tarde?",
];

export const DNI_WAITING = {
    standard: [
        "Sin problema, tómate tu tiempo. Cuando tengas tu DNI a la mano, escríbelo aquí (8 dígitos).",
        "Dale nomás, no hay apuro. Escríbelo cuando lo tengas.",
        "Tranquilo, aquí te espero. Mándalo cuando esté listo.",
    ],
    patient: [
        "Tómate el tiempo que necesites. Aquí estaré.",
        "Sin apuro, cuando puedas me lo mandas.",
        "Con calma, no hay prisa.",
    ],
};
