import type { PageServerLoad } from "./$types";
import { redirect } from "@sveltejs/kit";

export const load: PageServerLoad = async ({ locals, url }) => {
  // Check authentication server-side
  if (!locals.user) {
    const redirectTo = url.pathname + url.search;
    redirect(307, `/login?redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  // Check role authorization (only admin and developer can use simulator)
  if (locals.user.role !== "admin" && locals.user.role !== "developer") {
    redirect(303, "/dashboard");
  }

  // Pass load query params to page. `channel` names the number the conversation
  // being replayed happened on; a business with one number can leave it off.
  const loadPhone = url.searchParams.get("load");
  const loadChannel = url.searchParams.get("channel");

  return {
    user: locals.user,
    loadPhone,
    loadChannel,
  };
};
