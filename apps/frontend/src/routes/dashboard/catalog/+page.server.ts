import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    return { products: [] };
  }

  try {
    const response = await fetch("http://localhost:3000/api/catalog", {
      headers: { cookie: `session=${sessionToken}` },
    });

    if (response.ok) {
      return { products: await response.json() };
    }
  } catch {}

  return { products: [] };
};
