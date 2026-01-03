import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    return { stats: null, events: [] };
  }

  try {
    const [statsRes, eventsRes] = await Promise.all([
      fetch("http://localhost:3000/api/analytics/funnel", {
        headers: { cookie: `session=${sessionToken}` },
      }),
      fetch("http://localhost:3000/api/analytics/events?limit=100", {
        headers: { cookie: `session=${sessionToken}` },
      }),
    ]);

    const [statsData, eventsData] = await Promise.all([
      statsRes.ok ? statsRes.json() : Promise.resolve({ stats: null }),
      eventsRes.ok ? eventsRes.json() : Promise.resolve({ events: [] }),
    ]);

    return {
      stats: statsData.stats,
      events: eventsData.events,
    };
  } catch {
    return { stats: null, events: [] };
  }
};
