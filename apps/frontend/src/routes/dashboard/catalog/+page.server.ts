import type { PageServerLoad } from "./$types";
import { fetchBackend } from "$lib/utils/server-fetch";

export const load: PageServerLoad = async ({ cookies, url }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    return {
      baseProducts: [],
      bundles: [],
      fnbOfferings: [],
      periods: [],
      activePeriod: null,
    };
  }

  const headers = { cookie: `session=${sessionToken}` };

  try {
    // Load periods
    const periodsRes = await fetchBackend("/api/periods", { headers });
    const periods = periodsRes.ok ? await periodsRes.json() : [];

    // Get selected period from URL or use active period
    const selectedPeriodId = url.searchParams.get("period");
    let activePeriod =
      periods.find((p: any) => p.status === "active") || periods[0] || null;

    if (selectedPeriodId) {
      const selected = periods.find((p: any) => p.id === selectedPeriodId);
      if (selected) activePeriod = selected;
    }

    // Load data in parallel
    const [productsRes, bundlesRes, fnbRes] = await Promise.all([
      fetchBackend("/api/catalog/products", { headers }),
      activePeriod
        ? fetchBackend(`/api/catalog/bundles?period_id=${activePeriod.id}`, {
            headers,
          })
        : Promise.resolve({ ok: false, json: () => [] }),
      activePeriod
        ? fetchBackend(`/api/catalog/fnb?period_id=${activePeriod.id}`, {
            headers,
          })
        : Promise.resolve({ ok: false, json: () => [] }),
    ]);

    const baseProducts = productsRes.ok ? await productsRes.json() : [];
    const bundles = bundlesRes.ok ? await bundlesRes.json() : [];
    const fnbOfferings = fnbRes.ok ? await fnbRes.json() : [];

    return { baseProducts, bundles, fnbOfferings, periods, activePeriod };
  } catch (error) {
    console.error("Error loading catalog:", error);
    return {
      baseProducts: [],
      bundles: [],
      fnbOfferings: [],
      periods: [],
      activePeriod: null,
    };
  }
};
