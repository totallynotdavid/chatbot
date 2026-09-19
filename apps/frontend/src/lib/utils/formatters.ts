export function formatPrice(price: number): string {
  return price.toLocaleString("es-PE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDate(date: string | Date | number): string {
  return new Date(date).toLocaleDateString("es-PE", {
    timeZone: "America/Lima",
  });
}

export function formatDateTime(date: string | Date | number): string {
  return new Date(date).toLocaleString("es-PE", {
    timeZone: "America/Lima",
  });
}

export function formatTime(date: string | Date | number): string {
  return new Date(date).toLocaleTimeString("es-PE", {
    timeZone: "America/Lima",
  });
}

const LIMA_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The America/Lima calendar date `YYYY-MM-DD` of a ms timestamp, today by default. */
export function limaDateString(timestamp: number = Date.now()): string {
  const part = (type: string) =>
    LIMA_DATE.formatToParts(timestamp).find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function formatPhone(phone: string): string {
  const cleaned = phone.startsWith("51") ? phone.slice(2) : phone;
  if (cleaned.length === 9) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)}`;
  }
  return cleaned;
}

export function pluralize(
  count: number,
  singular: string,
  plural: string,
): string {
  return count === 1 ? singular : plural;
}
