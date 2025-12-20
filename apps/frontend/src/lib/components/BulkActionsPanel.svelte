<script lang="ts">
import type { Product, StockStatus } from "@totem/types";
import { toasts } from "$lib/toast.svelte";

type Props = {
    selectedProducts: Product[];
    onClose: () => void;
    onUpdate: () => void;
};

let { selectedProducts, onClose, onUpdate }: Props = $props();

let bulkAction = $state<"stock" | "activate" | "deactivate">("stock");
let stockStatus = $state<StockStatus>("in_stock");
let isProcessing = $state(false);

async function handleBulkAction() {
    if (selectedProducts.length === 0) return;

    isProcessing = true;

    try {
        let updates: Partial<Product> = {};

        switch (bulkAction) {
            case "stock":
                updates = { stock_status: stockStatus };
                break;
            case "activate":
                updates = { is_active: 1 };
                break;
            case "deactivate":
                updates = { is_active: 0 };
                break;
        }

        const productIds = selectedProducts.map((p) => p.id);

        const res = await fetch("/api/catalog/bulk-update", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                productIds,
                updates,
            }),
        });

        if (!res.ok) {
            throw new Error("Error en la operación masiva");
        }

        const data = await res.json();
        toasts.success(`${data.count} productos actualizados`);
        onUpdate();
        onClose();
    } catch (error) {
        console.error("Bulk action error:", error);
        toasts.error(
            error instanceof Error
                ? error.message
                : "Error al actualizar productos",
        );
    } finally {
        isProcessing = false;
    }
}
</script>

<div class="bulk-panel">
    <div class="bulk-header">
        <div class="flex items-center gap-4">
            <div class="selected-count">
                {selectedProducts.length}
            </div>
            <span class="text-sm font-bold uppercase tracking-wider text-cream-50">
                {selectedProducts.length === 1 ? "producto seleccionado" : "productos seleccionados"}
            </span>
        </div>
        <button onclick={onClose} class="text-cream-300 hover:text-white transition-colors" aria-label="Cerrar panel">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
    </div>

    <div class="bulk-actions">
        <div class="flex items-center gap-6 flex-1 flex-wrap">
            <label class="flex items-center gap-3 cursor-pointer group">
                <input
                    type="radio"
                    bind:group={bulkAction}
                    value="stock"
                    class="w-4 h-4 border-cream-50 text-ink-900 focus:ring-cream-50 bg-transparent"
                />
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
                <input
                    type="radio"
                    bind:group={bulkAction}
                    value="activate"
                    class="w-4 h-4 border-cream-50 text-ink-900 focus:ring-cream-50 bg-transparent"
                />
                <span class="text-sm font-medium text-cream-50 group-hover:text-white">Activar</span>
            </label>

            <label class="flex items-center gap-3 cursor-pointer group">
                <input
                    type="radio"
                    bind:group={bulkAction}
                    value="deactivate"
                    class="w-4 h-4 border-cream-50 text-ink-900 focus:ring-cream-50 bg-transparent"
                />
                <span class="text-sm font-medium text-cream-50 group-hover:text-white">Desactivar</span>
            </label>
        </div>

        <button
            onclick={handleBulkAction}
            disabled={isProcessing}
            class="bg-cream-50 text-ink-900 px-8 py-3 text-sm font-bold uppercase tracking-wider hover:bg-white transition-colors disabled:opacity-50"
        >
            {isProcessing ? "Procesando..." : "Aplicar cambios"}
        </button>
    </div>
</div>

<style>
.bulk-panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--color-ink-900);
    border-top: 1px solid var(--color-ink-600);
    z-index: 90;
    animation: slideUpPanel 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    color: var(--color-cream-50);
}

@keyframes slideUpPanel {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
}

.bulk-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 2rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.selected-count {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    background: var(--color-cream-50);
    color: var(--color-ink-900);
    font-weight: 700;
    font-size: 0.875rem;
}

.bulk-actions {
    display: flex;
    align-items: center;
    gap: 2rem;
    padding: 1.5rem 2rem;
    flex-wrap: wrap;
}

@media (max-width: 768px) {
    .bulk-header,
    .bulk-actions {
        padding-left: 1rem;
        padding-right: 1rem;
    }

    .bulk-actions {
        flex-direction: column;
        align-items: stretch;
        gap: 1.5rem;
    }

    .bulk-actions > * {
        width: 100%;
    }
}
</style>
