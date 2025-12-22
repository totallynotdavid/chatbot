import { describe, test, expect } from "bun:test";
import {
    isValidDNI,
    extractDNI,
    isValidAge,
    extractAge,
} from "../src/validation/regex";
import { sanitizeInput } from "../src/validation/input-sanitizer";

describe("DNI Validation", () => {
    describe("isValidDNI", () => {
        test("should accept valid 8-digit DNI", () => {
            expect(isValidDNI("72345678")).toBe(true);
            expect(isValidDNI("12345678")).toBe(true);
            expect(isValidDNI("87654321")).toBe(true);
        });

        test("should reject DNI with wrong length", () => {
            expect(isValidDNI("1234567")).toBe(false); // 7 digits
            expect(isValidDNI("123456789")).toBe(false); // 9 digits
            expect(isValidDNI("12345")).toBe(false); // 5 digits
        });

        test("should reject DNI with letters", () => {
            expect(isValidDNI("ABC12345")).toBe(false);
            expect(isValidDNI("7234567A")).toBe(false);
        });

        test("should reject DNI with special characters", () => {
            expect(isValidDNI("7234-5678")).toBe(false);
            expect(isValidDNI("72 345 678")).toBe(false);
        });

        test("should handle whitespace", () => {
            expect(isValidDNI(" 72345678 ")).toBe(true); // trim works
            expect(isValidDNI("72345678 ")).toBe(true);
            expect(isValidDNI(" 72345678")).toBe(true);
        });
    });

    describe("extractDNI", () => {
        test("should extract valid DNI from clean input", () => {
            expect(extractDNI("72345678")).toBe("72345678");
            expect(extractDNI("12345678")).toBe("12345678");
        });

        test("should extract DNI from text with words", () => {
            expect(extractDNI("Mi DNI es 72345678")).toBe("72345678");
            expect(extractDNI("72345678 es mi documento")).toBe("72345678");
            expect(extractDNI("tengo el 72345678 aquí")).toBe("72345678");
        });

        test("should extract DNI from text with special characters", () => {
            expect(extractDNI("DNI: 72345678")).toBe("72345678");
            expect(extractDNI("72-345-678")).toBe("72345678");
            expect(extractDNI("72 345 678")).toBe("72345678");
        });

        test("should return null for invalid lengths", () => {
            expect(extractDNI("1234567")).toBe(null); // 7 digits
            expect(extractDNI("123456789")).toBe(null); // 9 digits
        });

        test("should return null for no digits", () => {
            expect(extractDNI("abc")).toBe(null);
            expect(extractDNI("No tengo")).toBe(null);
        });

        test("should extract first 8 consecutive digits", () => {
            expect(extractDNI("12345678 y otros números 99999999")).toBe(
                "12345678",
            );
        });
    });
});

describe("Age Validation", () => {
    describe("isValidAge", () => {
        test("should accept valid ages 18-120", () => {
            expect(isValidAge("18")).toBe(true);
            expect(isValidAge("25")).toBe(true);
            expect(isValidAge("65")).toBe(true);
            expect(isValidAge("120")).toBe(true);
        });

        test("should reject ages below 18", () => {
            expect(isValidAge("17")).toBe(false);
            expect(isValidAge("10")).toBe(false);
            expect(isValidAge("5")).toBe(false);
        });

        test("should reject ages above 120", () => {
            expect(isValidAge("121")).toBe(false);
            expect(isValidAge("150")).toBe(false);
            expect(isValidAge("999")).toBe(false);
        });

        test("should reject non-numeric input", () => {
            expect(isValidAge("abc")).toBe(false);
            expect(isValidAge("25 años")).toBe(false);
        });
    });

    describe("extractAge", () => {
        test("should extract valid age from clean input", () => {
            expect(extractAge("25")).toBe(25);
            expect(extractAge("65")).toBe(65);
            expect(extractAge("18")).toBe(18);
        });

        test("should extract age from text with words", () => {
            expect(extractAge("Tengo 35 años")).toBe(35);
            expect(extractAge("35 años tengo")).toBe(35);
        });

        test("should extract age at boundaries", () => {
            expect(extractAge("18")).toBe(18);
            expect(extractAge("120")).toBe(120);
        });

        test("should return null for invalid ages", () => {
            expect(extractAge("17")).toBe(null); // Too young
            expect(extractAge("121")).toBe(null); // Too old
            expect(extractAge("5")).toBe(null);
            expect(extractAge("150")).toBe(null);
        });

        test("should return null for non-numeric", () => {
            expect(extractAge("abc")).toBe(null);
            expect(extractAge("veinte")).toBe(null);
        });

        test("should handle numbers with text", () => {
            expect(extractAge("Edad: 45")).toBe(45);
        });
    });
});

describe("Input Sanitization", () => {
    test("should trim whitespace", () => {
        expect(sanitizeInput("  hello  ")).toBe("hello");
        expect(sanitizeInput("\n\thello\n\t")).toBe("hello");
    });

    test("should preserve normal text", () => {
        expect(sanitizeInput("Hello world")).toBe("Hello world");
        expect(sanitizeInput("Tengo 25 años")).toBe("Tengo 25 años");
    });

    test("should handle empty input", () => {
        expect(sanitizeInput("")).toBe("");
        expect(sanitizeInput("   ")).toBe("");
    });

    test("should handle DNI input", () => {
        expect(sanitizeInput("72345678")).toBe("72345678");
        expect(sanitizeInput(" 72345678 ")).toBe("72345678");
    });

    test("should handle Spanish characters", () => {
        expect(sanitizeInput("Sí, tengo Cálidda")).toBe("Sí, tengo Cálidda");
        expect(sanitizeInput("¿Cuánto cuesta?")).toBe("¿Cuánto cuesta?");
    });

    test("should handle multi-line input", () => {
        const input = `Primera línea
        Segunda línea`;
        const result = sanitizeInput(input);
        expect(result).toContain("Primera línea");
        expect(result).toContain("Segunda línea");
    });
});

describe("Edge Cases and Security", () => {
    describe("DNI extraction security", () => {
        test("should not extract DNI from very long strings", () => {
            const longString = "1".repeat(100);
            expect(extractDNI(longString)).toBe(null);
        });

        test("should handle malformed input gracefully", () => {
            expect(extractDNI("")).toBe(null);
            expect(extractDNI("   ")).toBe(null);
        });

        test("should extract DNI from realistic user input", () => {
            expect(extractDNI("Mi DNI es el 72345678 por favor")).toBe(
                "72345678",
            );
            expect(extractDNI("72345678")).toBe("72345678");
            expect(extractDNI("dni: 72345678")).toBe("72345678");
        });
    });

    describe("Age extraction edge cases", () => {
        test("should handle boundary conditions", () => {
            expect(extractAge("18")).toBe(18);
            expect(extractAge("17")).toBe(null);
            expect(extractAge("120")).toBe(120);
            expect(extractAge("121")).toBe(null);
        });

        test("should not extract invalid patterns", () => {
            expect(extractAge("2023")).toBe(null); // Year
            expect(extractAge("12345")).toBe(null); // Too long
        });

        test("should handle realistic user input", () => {
            expect(extractAge("tengo 35")).toBe(35);
            expect(extractAge("35 años")).toBe(35);
            expect(extractAge("edad: 45")).toBe(45);
        });
    });

    describe("Sanitization edge cases", () => {
        test("should handle null-like values gracefully", () => {
            expect(sanitizeInput("")).toBe("");
        });

        test("should remove emojis", () => {
            expect(sanitizeInput("Hola 👋")).toBe("Hola");
        });

        test("should handle numbers", () => {
            expect(sanitizeInput("123")).toBe("123");
        });

        test("should handle URLs", () => {
            const url = "https://example.com/product";
            expect(sanitizeInput(url)).toBe(url);
        });
    });
});

describe("Real-world input patterns", () => {
    describe("Typical DNI inputs from users", () => {
        test("should handle various DNI formats", () => {
            const inputs = [
                "72345678",
                "DNI 72345678",
                "Mi DNI: 72345678",
                "72345678 es mi documento",
                "el dni es 72345678",
                "72 345 678",
                "72-345-678",
            ];

            for (const input of inputs) {
                const result = extractDNI(input);
                expect(result).toBe("72345678");
            }
        });
    });

    describe("Typical age inputs from users", () => {
        test("should handle various age formats", () => {
            const inputs = [
                { input: "35", expected: 35 },
                { input: "Tengo 35 años", expected: 35 },
                { input: "35 años", expected: 35 },
                { input: "edad: 45", expected: 45 },
                { input: "45", expected: 45 },
            ];

            for (const { input, expected } of inputs) {
                const result = extractAge(input);
                expect(result).toBe(expected);
            }
        });
    });

    describe("Ambiguous inputs that should NOT extract", () => {
        test("should not extract DNI from phone numbers", () => {
            // Phone numbers are typically longer
            expect(extractDNI("51987654321")).toBe(null); // 11 digits
        });

        test("should not extract age from dates", () => {
            expect(extractAge("2023")).toBe(null);
            expect(extractAge("1985")).toBe(null);
        });

        test("should not extract age from amounts", () => {
            expect(extractAge("1000")).toBe(null);
            expect(extractAge("500")).toBe(null);
        });
    });
});
