// Human-like message variations to avoid robotic repetition
// Each template has 3-5 variants that rotate per conversation session

export const GREETING = [
  "¡Hola! 👋 Soy de Cálidda. ¿Eres el titular de tu servicio de gas natural?",
  "Hola, te escribe Cálidda. ¿El servicio de gas está a tu nombre?",
  "¡Qué tal! Soy de Cálidda. ¿Tu servicio de gas está a tu nombre?",
  "Hola 👋 Soy de Cálidda. ¿Tu servicio de gas está a tu nombre?",
];

export const GREETING_RETURNING = (category: string) => [
  `¡Hola de nuevo! 😊 Veo que anteriormente te interesaron nuestros ${category}. ¿Quieres continuar donde lo dejamos?`,
  `Hola otra vez 👋 La última vez preguntaste por ${category}. ¿Te interesa ese u otro producto?`,
  `¡Qué bueno verte de nuevo! ¿Todavía te interesan los ${category}?`,
];

export const CONFIRM_CLIENT_YES = [
  "Perfecto 😊 ¿Me brindas el número de tu DNI?",
  "Genial. Por favor, indícame tu DNI para verificar tus beneficios.",
  "Excelente. Necesito tu DNI para consultar tu línea de crédito.",
  "Genial, ¿me brindas el número de tu DNI?",
];

export const CONFIRM_CLIENT_NO = [
  "Entiendo. Por el momento solo atendemos a clientes de Cálidda con servicio activo. ¡Gracias por tu interés! 🙏",
  "Te agradezco el interés 😊 Actualmente trabajamos solo con clientes de Cálidda. ¡Hasta pronto!",
  "Gracias por escribir. Por ahora atendemos únicamente a clientes con servicio Cálidda activo.",
];

export const INVALID_DNI = [
  "¿Podrías verificar tu DNI? Parece que falta algún número.",
  "Revísalo bien, por favor. El DNI no parece válido.",
  "El DNI no parece válido 😔. ¿Podrías verificarlo?",
];

export const NOT_ELIGIBLE = [
  "Disculpa, revisé tu caso y por ahora no podemos avanzar según nuestras políticas. Si tienes dudas, escríbeme y veo cómo ayudarte. 😔",
  "Lamentablemente no podemos proceder en este momento según las políticas internas de Cálidda 😢. ¿Hay algo más en lo que pueda ayudarte?",
  "Gracias por tu interés. Actualmente no podemos ofrecerte el servicio según nuestras políticas. 😔",
];

export const ASK_AGE = (name: string) => [
  `Perfecto ${name} 😊 Para continuar, ¿cuántos años tienes?`,
  `${name}, necesito confirmar tu edad. ¿Cuántos años tienes?`,
  `Dale ${name}. ¿Me confirmas tu edad?`,
];

export const INVALID_AGE = [
  "Por favor, indícame tu edad en números (ejemplo: 35).",
  "Necesito tu edad en números. ¿Cuántos años tienes?",
  "Escribe tu edad solo con números, por favor 😊",
];

export const AGE_TOO_LOW = (minAge: number) => [
  `Disculpa, para este programa necesitas tener al menos ${minAge} años según nuestras políticas. 😔`,
  `Lamentablemente la política requiere mínimo ${minAge} años para este servicio.`,
  `Según nuestras políticas, necesitas ${minAge} años o más para acceder al beneficio.`,
];

export const DNI_WAITING = {
  standard: [
    "Sin problema 😊 Tómate tu tiempo. Cuando tengas tu DNI, escríbelo aquí.",
    "Dale nomás, no hay apuro. Escríbelo cuando lo tengas.",
    "Tranquilo, aquí te espero. Mándalo cuando esté listo.",
  ],
  patient: [
    "Tómate el tiempo que necesites. Aquí estaré 😊",
    "Sin apuro, cuando puedas me lo mandas.",
    "Con calma, no hay prisa.",
  ],
};
