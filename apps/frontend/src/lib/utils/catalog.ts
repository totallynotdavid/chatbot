import type { StockStatus } from "@vendeya/types";
import { fetchApi } from "./api";

/** Sets a bundle's stock status. Rejects with `ApiError` if the API refuses. */
export function updateBundleStock(
  bundleId: string,
  stockStatus: StockStatus,
): Promise<unknown> {
  return fetchApi(`/api/catalog/bundles/${bundleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stock_status: stockStatus }),
  });
}
