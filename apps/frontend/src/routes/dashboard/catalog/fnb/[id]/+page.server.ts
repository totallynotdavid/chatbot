import type { PageServerLoad } from "./$types";
import { fetchBackend } from "$lib/utils/server-fetch";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async ({ cookies, params, url }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    throw error(401, "Unauthorized");
  }

  const headers = { cookie: `session=${sessionToken}` };
  const { id } = params;
  const periodId = url.searchParams.get("period");

  const [productsRes, offeringRes] = await Promise.all([
    fetchBackend("/api/catalog/products", { headers }),
    id !== "new" 
      ? fetchBackend(`/api/catalog/fnb/${id}`, { headers })
      : Promise.resolve(null)
  ]);

  const baseProducts = productsRes.ok ? await productsRes.json() : [];
  let offering = null;

  if (offeringRes) {
    if (offeringRes.ok) {
        offering = await offeringRes.json();
    } else {
        throw error(offeringRes.status, "Offering not found");
    }
  }

  return {
    baseProducts,
    offering,
    periodId: offering?.period_id || periodId
  };
};
