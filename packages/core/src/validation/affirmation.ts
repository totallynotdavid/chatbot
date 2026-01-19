export function isAffirmative(message: string): boolean {
  const lower = message.toLowerCase().trim();

  // Remove common trailing punctuation for matching
  const normalized = lower.replace(/[¡!¿?.,:;]+$/, "");

  // Tier 1: Single-word exact matches
  const exactWords =
    /^(sí|si|yes|sep|claro|ok|okey|okay|vale|dale|va|bueno|perfecto|afirmativo|correcto|confirmo|listo|adelante|seguro|obvio|definitivamente|excelente|genial|bien)$/i;
  if (exactWords.test(normalized)) {
    return true;
  }

  // Tier 2: Elongated affirmations
  const elongated =
    /^(s[íi]{2,}|s[iu]+|clar+o+|ok+e*y*|dal+e+|va+|buen+o+|list+o+|perfect+o+)$/i;
  if (elongated.test(normalized)) {
    return true;
  }

  // Tier 3: Repeated affirmations with spaces
  // "si si", "sí sí sí", "claro claro", "dale dale"
  const repeated = /^(s[íi]|claro|dale|ok)(\s+(s[íi]|claro|dale|ok))+$/i;
  if (repeated.test(normalized)) {
    return true;
  }

  // Tier 4: Common Spanish affirmative phrases
  const phrasePatterns = [
    /^(dale|va|claro)\s+que\s+s[íi]$/i, // "dale que sí", "claro que sí"
    /^s[íi]\s+(por\s+favor|porfavor|porfa)$/i, // "sí por favor"
    /^(quiero|acepto|confirmo)(\s+(la\s+)?compra)?$/i, // "confirmo", "acepto la compra"
    /^está\s+bien$/i, // "está bien"
    /^de\s+acuerdo$/i, // "de acuerdo"
    /^por\s+supuesto$/i, // "por supuesto"
    /^claro\s+que\s+(s[íi]|yes)$/i, // "claro que sí"
  ];

  for (const pattern of phrasePatterns) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  // Tier 5: Service-related affirmations
  const serviceAffirmations = [
    /^(soy|somos)\s+(cliente|clientes|titular|titulares)(\s+de\s+calidda)?$/i, // "soy cliente", "somos clientes"
    /^(sí,?\s+)?tengo\s+(gas|servicio|el\s+servicio)$/i, // "tengo gas", "sí tengo gas"
    /^(sí,?\s+)?cuento\s+con(\s+(gas|servicio))?$/i, // "cuento con gas"
    /^(sí,?\s+)?tenemos\s+(gas|servicio)$/i, // "tenemos gas" (plural)
  ];

  for (const pattern of serviceAffirmations) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

export function isNegative(message: string): boolean {
  const lower = message.toLowerCase().trim();
  const normalized = lower.replace(/[¡!¿?.,:;]+$/, "");

  // Tier 1: Single-word clear rejections
  const exactWords =
    /^(no|nop|nope|nah|nel|negativo|paso|nunca|jamás|tampoco)$/i;
  if (exactWords.test(normalized)) {
    return true;
  }

  // Tier 2: Clear rejection phrases (unambiguous)
  const rejectionPhrases = [
    /^no\s+(gracias|thanks|grax|thank\s+you)$/i, // "no gracias"
    /^(no\s+)?gracias\s+pero\s+no$/i, // "gracias pero no"
    /^nada(\s+gracias)?$/i, // "nada", "nada gracias"
    /^no\s+por\s+ahora$/i, // "no por ahora"
    /^mejor\s+no$/i, // "mejor no"
    /^(creo\s+que\s+)?no$/i, // "creo que no"
  ];

  for (const pattern of rejectionPhrases) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  // Tier 3: Service-related rejections
  const serviceRejections = [
    /^no\s+tengo(\s+(gas|servicio|el\s+servicio))?$/i, // "no tengo", "no tengo gas"
    /^no\s+soy\s+(cliente|titular)(\s+de\s+calidda)?$/i, // "no soy cliente"
    /^no\s+cuento\s+con(\s+(gas|servicio))?$/i, // "no cuento con gas"
    /^no\s+tenemos(\s+(gas|servicio))?$/i, // "no tenemos" (plural)
    /^no\s+somos\s+(clientes|titulares)$/i, // "no somos clientes"
  ];

  for (const pattern of serviceRejections) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

export function isSimpleAcknowledgment(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return /^(ok|ya|ahi|ahí|listo|va|bien|dale|oki|okey)$/i.test(lower);
}
