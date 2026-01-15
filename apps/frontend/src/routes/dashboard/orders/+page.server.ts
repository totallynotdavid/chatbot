import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, cookies }) => {
  const sessionToken = cookies.get("session");
  if (!sessionToken) {
    return { orders: [], metrics: null };
  }

  const status = url.searchParams.get("status") || "";
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";

  try {
    const params = new URLSearchParams();
    if (status) params.append("status", status);
    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);

    const [ordersRes, metricsRes] = await Promise.all([
      fetch(`/api/orders?${params.toString()}`, {
        headers: { cookie: `session=${sessionToken}` },
      }),
      fetch("/api/orders/metrics", {
        headers: { cookie: `session=${sessionToken}` },
      }),
    ]);

    const orders = ordersRes.ok ? await ordersRes.json() : [];
    const metrics = metricsRes.ok ? await metricsRes.json() : null;

    return { orders, metrics };
  } catch {
    return { orders: [], metrics: null };
  }
};
