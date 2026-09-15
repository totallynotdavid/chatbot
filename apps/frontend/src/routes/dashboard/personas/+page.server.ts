import type { PageServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";

export const load: PageServerLoad = async ({ locals }) => {
  // Role check: only admin and developer can manage test personas
  if (!locals.user) {
    redirect(307, "/login");
  }

  const allowedRoles = ["admin", "developer"];
  if (!locals.user.role || !allowedRoles.includes(locals.user.role)) {
    redirect(303, "/dashboard");
  }

  return {
    user: locals.user,
  };
};
