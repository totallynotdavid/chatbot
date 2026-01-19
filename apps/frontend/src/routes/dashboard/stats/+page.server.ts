import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ fetch, locals }) => {
  if (!locals.user) {
    throw error(401, "Unauthorized");
  }

  try {
    const res = await fetch("http://localhost:3000/api/intelligence/stats");

    if (!res.ok) {
      console.error("API Fetch Failed:", res.status, await res.text());
      throw new Error("Failed to fetch stats");
    }

    const data = await res.json();

    return {
      stats: data.stats,
      recentCalls: data.recentCalls,
      user: locals.user,
    };
  } catch (err) {
    console.error("Error loading intelligence stats:", err);
    return {
      stats: [],
      recentCalls: [],
      user: locals.user,
      error: "Could not load stats",
    };
  }
};

/*
app.get("/stats")
*/