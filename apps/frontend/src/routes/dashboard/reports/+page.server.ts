import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    return { user: null, todayCount: 0 };
  }

  try {
    const [userRes, countRes] = await Promise.all([
      fetch("http://localhost:3000/api/auth/me", {
        headers: { cookie: `session=${sessionToken}` },
      }),
      fetch("http://localhost:3000/api/reports/today-count", {
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
