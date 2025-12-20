export const GREETING = `¡Hola! Somos Tótem, aliados de Cálidda. ¿Eres el titular de tu servicio Cálidda?`;

export const GREETING_RETURNING = (category: string) =>
    `¡Hola de nuevo! Veo que anteriormente te interesaron nuestros ${category}. ¿Quieres continuar donde lo dejamos?`;

export const CONFIRM_CLIENT_YES = `Perfecto. Por favor, indícame tu número de DNI (8 dígitos) para verificar tus beneficios.`;

export const CONFIRM_CLIENT_NO = `Entiendo. Por el momento solo atendemos a clientes de Cálidda con servicio activo. ¡Gracias por tu interés!`;

export const INVALID_DNI = `El DNI debe tener exactamente 8 dígitos numéricos. Por favor, inténtalo nuevamente.`;

export const CHECKING_SYSTEM = `Consultando el sistema... ⏳`;

export const NOT_ELIGIBLE = `Lamentablemente, en este momento no podemos ofrecerte nuestros productos según nuestras políticas internas. Gracias por tu comprensión.`;

export const ASK_AGE = (name: string) =>
    `Hola ${name}, para continuar con tu solicitud, ¿cuántos años tienes?`;

export const INVALID_AGE = `Por favor, indícame tu edad en números (ejemplo: 35).`;

export const AGE_TOO_LOW = (minAge: number) =>
    `Para acceder a este beneficio, debes tener al menos ${minAge} años según las políticas de Cálidda.`;

export const UNCLEAR_RESPONSE = `Disculpa, no entendí tu respuesta. ¿Podrías explicarlo de nuevo?`;

export const ASK_CLARIFICATION = `¿Podrías ser más específico? Por ejemplo: "celular", "cocina", "laptop", etc.`;

export const NO_STOCK = `Lo siento, actualmente no tenemos disponibilidad en esa categoría. ¿Te interesa algo más?`;

export const ESCALATED_TO_HUMAN = `Un asesor se pondrá en contacto contigo en breve para finalizar tu solicitud. ¡Gracias!`;

export const SESSION_TIMEOUT_CLOSING = `Noto que ha pasado un tiempo. Si necesitas algo más, no dudes en escribirme nuevamente. ¡Hasta pronto!`;

export const IMAGE_REJECTED = `Por tu seguridad y privacidad, solo aceptamos información por texto escrito. Por favor, escribe tu DNI (8 dígitos).`;

export const NON_TEXT_REJECTED = `En este momento solo puedo procesar mensajes de texto. ¿En qué puedo ayudarte?`;

export const DNI_NOT_AVAILABLE = `Entiendo. Puedo esperar mientras lo buscas, o si prefieres, un asesor humano puede contactarte más tarde. ¿Qué prefieres?`;

export const DNI_WAITING = `Sin problema, tómate tu tiempo. Cuando tengas tu DNI a la mano, escríbelo aquí (8 dígitos).`;
