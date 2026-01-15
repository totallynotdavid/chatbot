import type { PageServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";

export const load: PageServerLoad = async ({ cookies, locals }) => {
  // Role check: only admin, developer, supervisor
  if (!locals.user) {
    redirect(307, "/login");
  }

  const allowedRoles = ["admin", "developer", "supervisor"];
  if (!allowedRoles.includes(locals.user.role)) {
    redirect(303, "/dashboard");
  }

  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    return { stats: null, events: [] };
  }

  try {
    const [statsRes, eventsRes] = await Promise.all([
      fetch("/api/analytics/funnel", {
        headers: { cookie: `session=${sessionToken}` },
      }),
      fetch("/api/analytics/events?limit=100", {
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
