import type { PageServerLoad } from "./$types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async ({ cookies, params }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    throw error(401, "Unauthorized");
  }

  const { id } = params;
  if (id === "new") {
      return { product: null };
  }

  const headers = { cookie: `session=${sessionToken}` };
  const getRes = await fetch(`/api/catalog/products/${id}`, { headers });
  
  if (!getRes.ok) {
        throw error(getRes.status, "Product not found");
  }
  
  const product = await getRes.json();
  return { product };
};
