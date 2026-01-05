import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, cookies }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    return { conversation: null, messages: [], events: [] };
  }

  try {
    const res = await fetch(
      `http://localhost:3000/api/conversations/${params.phone}`,
      {
        headers: { cookie: `session=${sessionToken}` },
      },
    );

    if (!res.ok) {
      return { conversation: null, messages: [], events: [] };
    }

    const data = await res.json();
    return {
      conversation: data.conversation,
      messages: data.messages,
      events: data.events,
    };
  } catch {
    return { conversation: null, messages: [], events: [] };
  }
};
