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

    // Pass load query param to page
    const loadPhone = url.searchParams.get("load");

    return {
        user: locals.user,
        loadPhone,
    };
};
