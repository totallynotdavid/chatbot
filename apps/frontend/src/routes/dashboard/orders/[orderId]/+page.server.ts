import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    return { order: null };
  }

  try {
    const res = await fetch(`/api/orders/${params.orderId}`, {
      headers: { cookie: `session=${sessionToken}` },
    });

    if (!res.ok) {
      return { order: null };
    }

    const order = await res.json();
    return { order };
  } catch {
    return { order: null };
  }
};
