<script lang="ts">
import type { Product, StockStatus } from "@totem/types";
import Button from "$lib/components/ui/button.svelte";
import { toast } from "$lib/state/toast.svelte";
import { fetchApi } from "$lib/utils/api";
import { pluralize } from "$lib/utils/formatters";

type Props = {
    selectedProducts: Product[];
    onClose: () => void;
    onSuccess: () => void;
};

let { selectedProducts, onClose, onSuccess }: Props = $props();

let bulkAction = $state<"stock" | "activate" | "deactivate">("stock");
let stockStatus = $state<StockStatus>("in_stock");
let isProcessing = $state(false);

async function handleBulkAction() {
    if (selectedProducts.length === 0) return;

    isProcessing = true;
    try {
        const updates: Partial<Product> =
            bulkAction === "stock"
                ? { stock_status: stockStatus }
                : { is_active: bulkAction === "activate" ? 1 : 0 };

        const productIds = selectedProducts.map((p) => p.id);

        const data = await fetchApi<{ count: number }>(
            "/api/catalog/bulk-update",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productIds, updates }),
            },
        );

        toast.success(
            `${data.count} ${pluralize(data.count, "producto actualizado", "productos actualizados")}`,
        );
        onSuccess();
        onClose();
    } catch (error) {
        toast.error("Error al actualizar productos");
    } finally {
        isProcessing = false;
    }
}
</script>

<div class="fixed bottom-0 left-0 right-0 bg-ink-900 border-t border-ink-600 z-40 animate-in slide-in-from-bottom duration-300">
	<div class="flex justify-between items-center px-8 py-4 border-b border-white/10">
		<div class="flex items-center gap-4">
			<div class="flex items-center justify-center w-8 h-8 bg-cream-50 text-ink-900 font-bold text-sm">
				{selectedProducts.length}
			</div>
			<span class="text-sm font-bold uppercase tracking-wider text-cream-50">
				{pluralize(selectedProducts.length, "producto seleccionado", "productos seleccionados")}
			</span>
		</div>
		<button
			onclick={onClose}
			class="text-cream-300 hover:text-white transition-colors"
			aria-label="Cerrar panel"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<line x1="18" y1="6" x2="6" y2="18"/>
				<line x1="6" y1="6" x2="18" y2="18"/>
			</svg>
		</button>
	</div>

	<div class="flex items-center gap-6 px-8 py-6 flex-wrap">
		<div class="flex items-center gap-6 flex-1 flex-wrap">
			<label class="flex items-center gap-3 cursor-pointer group">
				<input type="radio" bind:group={bulkAction} value="stock" class="w-4 h-4" />
				<span class="text-sm font-medium text-cream-50 group-hover:text-white">Cambiar stock:</span>
			</label>
			<select
				bind:value={stockStatus}
				disabled={bulkAction !== "stock"}
				class="bg-ink-800 border border-cream-50/30 text-cream-50 text-sm font-medium px-3 py-2 rounded-none focus:border-cream-50 focus:ring-0 disabled:opacity-50"
			>
				<option value="in_stock">En stock</option>
				<option value="low_stock">Stock bajo</option>
				<option value="out_of_stock">Agotado</option>
			</select>

			<div class="h-8 w-px bg-cream-50/20 mx-2 hidden md:block"></div>

			<label class="flex items-center gap-3 cursor-pointer group">
				<input type="radio" bind:group={bulkAction} value="activate" class="w-4 h-4" />
				<span class="text-sm font-medium text-cream-50 group-hover:text-white">Activar</span>
			</label>

			<label class="flex items-center gap-3 cursor-pointer group">
				<input type="radio" bind:group={bulkAction} value="deactivate" class="w-4 h-4" />
				<span class="text-sm font-medium text-cream-50 group-hover:text-white">Desactivar</span>
			</label>
		</div>

		<Button onclick={handleBulkAction} disabled={isProcessing} class="shrink-0">
			{isProcessing ? "Procesando..." : "Aplicar cambios"}
		</Button>
	</div>
</div>
