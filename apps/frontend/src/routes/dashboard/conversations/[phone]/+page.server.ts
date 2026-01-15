import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    return { conversation: null, messages: [], events: [], user: null };
  }

  try {
    const [convRes, userRes] = await Promise.all([
      fetch(`/api/conversations/${params.phone}`, {
        headers: { cookie: `session=${sessionToken}` },
      }),
      fetch("/api/auth/me", {
        headers: { cookie: `session=${sessionToken}` },
      }),
    ]);

    const userData = userRes.ok ? await userRes.json() : { user: null };

    if (!convRes.ok) {
      return {
        conversation: null,
        messages: [],
        events: [],
        order: null,
        user: userData.user,
      };
    }

    const data = await convRes.json();

    // Load order if conversation exists
    let orderData = null;
    if (data.conversation) {
      const orderRes = await fetch(
        `/api/orders/by-conversation/${params.phone}`,
        { headers: { cookie: `session=${sessionToken}` } },
      );
      if (orderRes.ok) {
        const orderJson = await orderRes.json();
        orderData = orderJson.order;
      }
    }

    return {
      conversation: data.conversation,
      messages: data.messages,
      events: data.events,
      order: orderData,
      user: userData.user,
    };
  } catch {
    return {
      conversation: null,
      messages: [],
      events: [],
      order: null,
      user: null,
    };
  }
};
