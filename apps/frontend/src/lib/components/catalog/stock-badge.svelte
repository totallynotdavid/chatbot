<script lang="ts">
import type { StockStatus } from "@totem/types";
import { toast } from "$lib/state/toast.svelte";
import { fetchApi } from "$lib/utils/api";
import Dropdown from "$lib/components/ui/dropdown.svelte";
import DropdownTrigger from "$lib/components/ui/dropdown-trigger.svelte";
import DropdownMenu from "$lib/components/ui/dropdown-menu.svelte";
import DropdownItem from "$lib/components/ui/dropdown-item.svelte";

type Props = {
    productId: string;
    productName: string;
    stockStatus: StockStatus;
    canEdit: boolean;
    onUpdate: (newStatus: StockStatus) => void;
};

let { productId, productName, stockStatus, canEdit, onUpdate }: Props =
    $props();

let open = $state(false);
let isUpdating = $state(false);

const statusConfig = {
    in_stock: {
        label: "En stock",
        class: "bg-ink-900 text-white border-ink-900",
    },
    low_stock: {
        label: "Stock bajo",
        class: "bg-white text-ink-900 border-ink-200",
    },
    out_of_stock: {
        label: "Agotado",
        class: "bg-white text-ink-300 border-ink-100 line-through decoration-ink-300",
    },
};

async function updateStatus(newStatus: StockStatus) {
    if (isUpdating || newStatus === stockStatus) {
        open = false;
        return;
    }

    isUpdating = true;
    try {
        await fetchApi(`/api/catalog/${productId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stock_status: newStatus }),
        });
        onUpdate(newStatus);
        toast.success(`${productName}: ${statusConfig[newStatus].label}`);
    } catch (error) {
        toast.error(`Error al actualizar ${productName}`);
    } finally {
        isUpdating = false;
        open = false;
    }
}
</script>

<Dropdown bind:open>
	<DropdownTrigger
		onclick={() => canEdit && !isUpdating && (open = !open)}
		disabled={!canEdit || isUpdating}
		class="inline-flex items-center gap-2 px-3 py-1 border text-[10px] font-bold uppercase tracking-wider rounded-full transition-all {statusConfig[stockStatus].class} {canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}"
	>
		<span>{statusConfig[stockStatus].label}</span>
		{#if canEdit}
			<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
				<polyline points="6 9 12 15 18 9"/>
			</svg>
		{/if}
	</DropdownTrigger>

	<DropdownMenu
		{open}
		class="absolute top-full left-0 mt-2 min-w-35 bg-white border border-ink-200 shadow-lg rounded-lg overflow-hidden z-50"
	>
		{#each Object.entries(statusConfig) as [status, config]}
			<DropdownItem
				onclick={() => updateStatus(status as StockStatus)}
				disabled={isUpdating || status === stockStatus}
				class="w-full text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-600 hover:bg-ink-50 focus:bg-ink-50 transition-colors border-b last:border-b-0 border-ink-50 disabled:opacity-50 cursor-pointer outline-none"
			>
				{config.label}
			</DropdownItem>
		{/each}
	</DropdownMenu>
</Dropdown>
