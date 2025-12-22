export type GasoEligibilityResult =
    | { eligible: true; maxCredit: number; maxInstallments: number }
    | { eligible: false; reason: string };

export function checkGasoEligibility(
    age: number,
    nse: number,
    rawCredit: number,
): GasoEligibilityResult {
    // Validate NSE range
    if (nse < 1 || nse > 5) {
        return { eligible: false, reason: "invalid_nse" };
    }

    // Age and credit rules by NSE stratum
    if (nse <= 2) {
        // Stratum 1-2: min age 40, max credit 3000, max installments 18
        if (age < 40) {
            return { eligible: false, reason: "age_too_low_for_stratum" };
        }
        const maxCredit = Math.min(rawCredit, 3000);
        return { eligible: true, maxCredit, maxInstallments: 18 };
    }

    if (nse === 3) {
        // Stratum 3: min age 30, max credit 5000, max installments 18
        if (age < 30) {
            return { eligible: false, reason: "age_too_low_for_stratum" };
        }
        const maxCredit = Math.min(rawCredit, 5000);
        return { eligible: true, maxCredit, maxInstallments: 18 };
    }

    if (nse >= 4) {
        // Stratum 4-5: No age restriction, max credit 5000, max installments 60
        const maxCredit = Math.min(rawCredit, 5000);
        return { eligible: true, maxCredit, maxInstallments: 60 };
    }

    return { eligible: false, reason: "invalid_nse" };
}
