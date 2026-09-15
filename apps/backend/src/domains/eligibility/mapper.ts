import type { EnrichmentResult } from "@totem/core";
import { BundleService } from "../catalog/index.ts";
import { getCategoryDisplayNames } from "../../adapters/catalog/display.ts";
import { CATEGORIES, CATEGORY_GROUPS } from "@totem/types";
import type {
  CategoryGroup,
  CategoryKey,
  ProviderCheckResult,
} from "@totem/types";

type EligibilityResult = ProviderCheckResult & {
  needsHuman?: boolean;
  handoffReason?: string;
  name?: string;
  nse?: number;
};

/**
 * `tenantId` is null when nothing owns the check: GET /api/providers/:dni is an
 * operator's provider diagnostic, not a conversation, so there is no business
 * whose catalog the answer could be about.
 *
 * That case used to be passed down as the empty string, which reached
 * `WHERE b.tenant_id = ?` and matched no tenant - so a genuinely eligible DNI
 * came back "eligible, and nothing is affordable", indistinguishable from a real
 * empty catalog and wrong whatever the catalog held. The verdict is what that
 * endpoint asks for; the catalog is simply not consulted, and `catalogChecked`
 * says so rather than an empty list implying an answer nobody computed.
 */
export function mapEligibilityToEnrichment(
  tenantId: string | null,
  result: EligibilityResult,
): Extract<EnrichmentResult, { type: "eligibility_result" }> {
  if (result.needsHuman) {
    if (result.handoffReason === "both_providers_down") {
      return {
        type: "eligibility_result",
        status: "system_outage",
        handoffReason: result.handoffReason,
      };
    }
    return {
      type: "eligibility_result",
      status: "needs_human",
      handoffReason: result.handoffReason,
    };
  }

  if (result.eligible) {
    const segment = result.nse !== undefined ? "gaso" : "fnb";
    const credit = result.credit || 0;

    if (tenantId === null) {
      return {
        type: "eligibility_result",
        status: "eligible",
        segment,
        credit,
        name: result.name,
        nse: result.nse,
        requiresAge: segment === "gaso",
        catalogChecked: false,
      };
    }

    const affordableCategories = BundleService.getAffordableCategories(
      tenantId,
      segment,
      credit,
    );

    const groups = new Set<CategoryGroup>();
    for (const categoryKey of affordableCategories) {
      const category = CATEGORIES[categoryKey as CategoryKey];
      if (category?.group) groups.add(category.group);
    }

    const groupDisplayNames: string[] = [];
    for (const groupKey of groups) {
      const display = CATEGORY_GROUPS[groupKey]?.display;
      if (display) {
        groupDisplayNames.push(display);
      }
    }

    groupDisplayNames.sort((a, b) => {
      const order: Record<string, number> = {
        "línea blanca y hogar": 0,
        tecnología: 1,
        combos: 2,
      };
      const aKey = a.toLowerCase();
      const bKey = b.toLowerCase();
      return (order[aKey] ?? 99) - (order[bKey] ?? 99);
    });

    const affordableBundles = BundleService.getAvailable(tenantId, {
      segment,
      maxPrice: credit,
      strictPriceLimit: segment === "gaso", // gaso is strict, fnb is soft
    });

    return {
      type: "eligibility_result",
      status: "eligible",
      segment,
      credit,
      name: result.name,
      nse: result.nse,
      requiresAge: segment === "gaso",
      affordableCategories,
      categoryDisplayNames: getCategoryDisplayNames(affordableCategories),
      groupDisplayNames,
      affordableBundles,
      catalogChecked: true,
    };
  }

  return {
    type: "eligibility_result",
    status: "not_eligible",
  };
}
