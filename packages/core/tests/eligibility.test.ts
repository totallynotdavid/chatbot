import { describe, test, expect } from "bun:test";
import {
  checkFNBEligibility,
  getFNBCreditTier,
} from "../src/eligibility/fnb-logic";

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
