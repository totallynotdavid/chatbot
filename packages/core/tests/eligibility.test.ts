import { describe, test, expect } from "bun:test";
import {
    checkFNBEligibility,
    getFNBCreditTier,
} from "../src/eligibility/fnb-logic";
import { checkGasoEligibility } from "../src/eligibility/gaso-logic";

describe("FNB Eligibility Logic", () => {
    describe("checkFNBEligibility", () => {
        test("should accept credit >= 100", () => {
            expect(checkFNBEligibility(100)).toBe(true);
            expect(checkFNBEligibility(500)).toBe(true);
            expect(checkFNBEligibility(10000)).toBe(true);
        });

        test("should reject credit < 100", () => {
            expect(checkFNBEligibility(99)).toBe(false);
            expect(checkFNBEligibility(50)).toBe(false);
            expect(checkFNBEligibility(0)).toBe(false);
        });

        test("should handle edge case at threshold", () => {
            expect(checkFNBEligibility(100)).toBe(true);
            expect(checkFNBEligibility(99.99)).toBe(false);
        });
    });

    describe("getFNBCreditTier", () => {
        test("should return low for credit < 1000", () => {
            expect(getFNBCreditTier(100)).toBe("low");
            expect(getFNBCreditTier(500)).toBe("low");
            expect(getFNBCreditTier(999)).toBe("low");
        });

        test("should return medium for credit 1000-2999", () => {
            expect(getFNBCreditTier(1000)).toBe("medium");
            expect(getFNBCreditTier(2000)).toBe("medium");
            expect(getFNBCreditTier(2999)).toBe("medium");
        });

        test("should return high for credit 3000-4999", () => {
            expect(getFNBCreditTier(3000)).toBe("high");
            expect(getFNBCreditTier(4000)).toBe("high");
            expect(getFNBCreditTier(4999)).toBe("high");
        });

        test("should return premium for credit >= 5000", () => {
            expect(getFNBCreditTier(5000)).toBe("premium");
            expect(getFNBCreditTier(10000)).toBe("premium");
            expect(getFNBCreditTier(50000)).toBe("premium");
        });
    });
});

describe("GASO Eligibility Logic", () => {
    describe("NSE Stratum 1-2 (restrictive)", () => {
        test("should reject age < 40", () => {
            const result = checkGasoEligibility(39, 2, 5000);
            expect(result.eligible).toBe(false);
            expect(result.reason).toBe("age_too_low_for_stratum");
        });

        test("should accept age >= 40", () => {
            const result = checkGasoEligibility(40, 2, 5000);
            expect(result.eligible).toBe(true);
        });

        test("should cap credit at 3000", () => {
            const result = checkGasoEligibility(45, 1, 8000);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                expect(result.maxCredit).toBe(3000);
            }
        });

        test("should set max installments to 18", () => {
            const result = checkGasoEligibility(50, 2, 5000);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                expect(result.maxInstallments).toBe(18);
            }
        });

        test("should not cap credit if already below 3000", () => {
            const result = checkGasoEligibility(45, 2, 2500);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                expect(result.maxCredit).toBe(2500);
            }
        });
    });

    describe("NSE Stratum 3 (moderate)", () => {
        test("should reject age < 30", () => {
            const result = checkGasoEligibility(29, 3, 5000);
            expect(result.eligible).toBe(false);
            expect(result.reason).toBe("age_too_low_for_stratum");
        });

        test("should accept age >= 30", () => {
            const result = checkGasoEligibility(30, 3, 5000);
            expect(result.eligible).toBe(true);
        });

        test("should cap credit at 5000", () => {
            const result = checkGasoEligibility(35, 3, 10000);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                expect(result.maxCredit).toBe(5000);
            }
        });

        test("should set max installments to 18", () => {
            const result = checkGasoEligibility(35, 3, 5000);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                expect(result.maxInstallments).toBe(18);
            }
        });
    });

    describe("NSE Stratum 4-5 (flexible)", () => {
        test("should accept any age >= 18", () => {
            const result18 = checkGasoEligibility(18, 4, 5000);
            expect(result18.eligible).toBe(true);

            const result25 = checkGasoEligibility(25, 5, 5000);
            expect(result25.eligible).toBe(true);
        });

        test("should cap credit at 5000", () => {
            const result = checkGasoEligibility(25, 4, 15000);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                expect(result.maxCredit).toBe(5000);
            }
        });

        test("should set max installments to 60 (premium)", () => {
            const result = checkGasoEligibility(30, 5, 5000);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                expect(result.maxInstallments).toBe(60);
            }
        });
    });

    describe("Edge cases and boundary conditions", () => {
        test("should handle exact age thresholds", () => {
            // NSE 1-2: exactly 40
            const result1 = checkGasoEligibility(40, 2, 5000);
            expect(result1.eligible).toBe(true);

            // NSE 3: exactly 30
            const result2 = checkGasoEligibility(30, 3, 5000);
            expect(result2.eligible).toBe(true);

            // NSE 4: exactly 18
            const result3 = checkGasoEligibility(18, 4, 5000);
            expect(result3.eligible).toBe(true);
        });

        test("should handle exact credit thresholds", () => {
            // Exactly 3000 for NSE 1-2
            const result1 = checkGasoEligibility(45, 2, 3000);
            expect(result1.eligible).toBe(true);
            if (result1.eligible) {
                expect(result1.maxCredit).toBe(3000);
            }

            // Exactly 5000 for NSE 3
            const result2 = checkGasoEligibility(35, 3, 5000);
            expect(result2.eligible).toBe(true);
            if (result2.eligible) {
                expect(result2.maxCredit).toBe(5000);
            }

            // Exactly 5000 for NSE 4
            const result3 = checkGasoEligibility(25, 4, 5000);
            expect(result3.eligible).toBe(true);
            if (result3.eligible) {
                expect(result3.maxCredit).toBe(5000);
            }
        });

        test("should reject invalid NSE values", () => {
            const result1 = checkGasoEligibility(30, 0, 5000);
            expect(result1.eligible).toBe(false);
            expect(result1.reason).toBe("invalid_nse");

            const result2 = checkGasoEligibility(30, 6, 5000);
            expect(result2.eligible).toBe(false);
            expect(result2.reason).toBe("invalid_nse");
        });

        test("should handle very high credit amounts", () => {
            const result = checkGasoEligibility(50, 4, 50000);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                // Should still cap at 5000
                expect(result.maxCredit).toBe(5000);
            }
        });

        test("should handle low credit amounts", () => {
            const result = checkGasoEligibility(45, 2, 500);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                // Should not modify credit if below cap
                expect(result.maxCredit).toBe(500);
            }
        });
    });

    describe("Real-world scenarios", () => {
        test("Young NSE 1-2 client should be rejected", () => {
            // 25-year-old from low-income area
            const result = checkGasoEligibility(25, 1, 4000);
            expect(result.eligible).toBe(false);
            expect(result.reason).toBe("age_too_low_for_stratum");
        });

        test("Middle-aged NSE 3 client should get capped credit", () => {
            // 35-year-old middle class
            const result = checkGasoEligibility(35, 3, 8000);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                expect(result.maxCredit).toBe(5000);
                expect(result.maxInstallments).toBe(18);
            }
        });

        test("Young NSE 4 client should get full benefits", () => {
            // 22-year-old from high-income area
            const result = checkGasoEligibility(22, 4, 10000);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                expect(result.maxCredit).toBe(5000);
                expect(result.maxInstallments).toBe(60);
            }
        });

        test("Older NSE 1 client should get restricted terms", () => {
            // 50-year-old low income
            const result = checkGasoEligibility(50, 1, 10000);
            expect(result.eligible).toBe(true);
            if (result.eligible) {
                expect(result.maxCredit).toBe(3000); // Heavily capped
                expect(result.maxInstallments).toBe(18);
            }
        });
    });
});

describe("Cross-segment eligibility comparison", () => {
    test("FNB should be more flexible than GASO", () => {
        // FNB only requires credit >= 100
        expect(checkFNBEligibility(100)).toBe(true);

        // GASO has age restrictions based on NSE
        const gasoLowNSE = checkGasoEligibility(25, 2, 5000);
        expect(gasoLowNSE.eligible).toBe(false);
    });

    test("FNB has no age restrictions", () => {
        // FNB only checks credit, not age
        expect(checkFNBEligibility(5000)).toBe(true);
    });

    test("GASO caps credit, FNB does not", () => {
        // FNB allows any credit amount
        expect(getFNBCreditTier(50000)).toBe("premium");

        // GASO caps at 3000 or 5000 depending on NSE
        const gasoResult = checkGasoEligibility(45, 2, 50000);
        if (gasoResult.eligible) {
            expect(gasoResult.maxCredit).toBe(3000);
        }
    });
});
