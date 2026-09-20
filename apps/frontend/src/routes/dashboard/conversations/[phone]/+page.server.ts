import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url, cookies, fetch }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    return { conversation: null, messages: [], events: [], user: null };
  }

  // A conversation is (tenant, channel account, phone number). The inbox links
  // carry the channel account. Without it the API refuses to guess between two
  // threads from the same contact on different business numbers.
  const channel = url.searchParams.get("channel");
  const channelQuery = channel ? `?channel=${encodeURIComponent(channel)}` : "";

  try {
    const [convRes, userRes] = await Promise.all([
      fetch(`/api/conversations/${params.phone}${channelQuery}`, {
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
        `/api/orders/by-conversation/${params.phone}${channelQuery}`,
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
