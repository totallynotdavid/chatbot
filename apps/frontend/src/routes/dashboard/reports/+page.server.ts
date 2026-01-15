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
    return { user: null, todayCount: 0 };
  }

  try {
    const [userRes, countRes] = await Promise.all([
      fetch("/api/auth/me", {
        headers: { cookie: `session=${sessionToken}` },
      }),
      fetch("/api/reports/today-count", {
        headers: { cookie: `session=${sessionToken}` },
      }),
    ]);

    const [userData, countData] = await Promise.all([
      userRes.ok ? userRes.json() : Promise.resolve(null),
      countRes.ok ? countRes.json() : Promise.resolve({ count: 0 }),
    ]);

    return {
      user: userData,
      todayCount: countData.count ?? 0,
    };
  } catch {
    return { user: null, todayCount: 0 };
  }
};
