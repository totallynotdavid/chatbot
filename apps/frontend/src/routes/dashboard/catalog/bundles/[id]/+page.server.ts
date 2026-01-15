import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async ({ cookies, params, url }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    throw error(401, "Unauthorized");
  }

  const headers = { cookie: `session=${sessionToken}` };
  const { id } = params;
  const periodId = url.searchParams.get("period");
  const segment = url.searchParams.get("segment") as "gaso" | "fnb" | null;

  const [productsRes, bundleRes] = await Promise.all([
    fetch("/api/catalog/products", { headers }),
    id !== "new"
      ? fetch(`/api/catalog/bundles/${id}`, { headers })
      : Promise.resolve(null)
  ]);

  const baseProducts = productsRes.ok ? await productsRes.json() : [];
  let bundle = null;

  if (bundleRes) {
    if (bundleRes.ok) {
      bundle = await bundleRes.json();
    } else {
      throw error(bundleRes.status, "Bundle not found");
    }
  }

  return {
    baseProducts,
    bundle,
    periodId: bundle?.period_id || periodId,
    segment: bundle?.segment || segment || "gaso"
  };
};
