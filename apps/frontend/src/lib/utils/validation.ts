export function validateRequired(
    value: string,
    fieldName: string,
): string | null {
    return value.trim() ? null : `${fieldName} es requerido`;
}

export function validatePositiveNumber(
    value: string,
    fieldName: string,
): string | null {
    const num = parseFloat(value);
    if (Number.isNaN(num)) return `${fieldName} debe ser un número`;
    if (num <= 0) return `${fieldName} debe ser mayor a 0`;
    return null;
}

export function validateDni(dni: string): string | null {
    if (!/^\d{8}$/.test(dni)) return "El DNI debe tener 8 dígitos";
    return null;
}

export function validateImage(
    file: File | null,
    required = false,
): string | null {
    if (!file) return required ? "La imagen es requerida" : null;
    if (!file.type.startsWith("image/")) return "El archivo debe ser una imagen";
    return null;
}

export type ValidationErrors = Record<string, string>;

export function hasErrors(errors: ValidationErrors): boolean {
    return Object.keys(errors).length > 0;
}
