import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    return { conversations: [] };
  }

  try {
    const response = await fetch("http://localhost:3000/api/conversations", {
      headers: { cookie: `session=${sessionToken}` },
    });

    if (response.ok) {
      return { conversations: await response.json() };
    }
  } catch {}

  return { conversations: [] };
};
