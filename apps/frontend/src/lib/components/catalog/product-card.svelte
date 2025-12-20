<script lang="ts">
import type { Product, StockStatus } from "@totem/types";
import StockBadge from "./stock-badge.svelte";
import { formatPrice } from "$lib/utils/formatters";

type Props = {
	product: Product;
	canEdit: boolean;
	onStockUpdate: (newStatus: StockStatus) => void;
	onclick?: () => void;
};

let { product, canEdit, onStockUpdate, onclick }: Props = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="group flex flex-col h-full bg-white hover:bg-cream-50 p-4 transition-all duration-300 border border-transparent hover:border-ink-200 {canEdit ? 'cursor-pointer' : ''}"
	onclick={onclick}
>
	<div class="aspect-square w-full bg-white mb-3 overflow-hidden relative mix-blend-multiply">
		<img
			src="/static/{product.image_main_path}"
			alt={product.name}
			class="w-full h-full object-contain transition-transform duration-500"
			onerror={(e) => {
				const target = e.currentTarget;
				if (target instanceof HTMLImageElement) {
					target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23f3f3ef' width='200' height='200'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' fill='%23888' font-size='14'%3ENo image%3C/text%3E%3C/svg%3E";
				}
			}}
		/>
		{#if product.is_active === 0}
			<div class="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex items-center justify-center">
				<span class="text-ink-400 font-bold uppercase text-xs tracking-wider border border-ink-200 px-2 py-1">
					Inactivo
				</span>
			</div>
		{/if}
	</div>

	<div class="flex justify-between items-center mb-4">
		<span class="text-[10px] font-bold uppercase tracking-widest text-ink-400">
			{product.category}
		</span>
		<div onclick={(e) => e.stopPropagation()} role="presentation">
			<StockBadge
				productId={product.id}
				productName={product.name}
				stockStatus={product.stock_status}
				canEdit={canEdit}
				onUpdate={onStockUpdate}
			/>
		</div>
	</div>

	<h3 class="font-serif text-lg leading-tight text-ink-900 mb-2">
		{product.name}
	</h3>

	<div class="mt-auto pt-3 border-t border-ink-900/5 flex items-baseline justify-between">
		<p class="font-mono text-lg text-ink-900">S/ {formatPrice(product.price)}</p>
		{#if product.installments}
			<p class="text-[10px] text-ink-400 uppercase tracking-wider">
				{product.installments} cuotas
			</p>
		{/if}
	</div>
</div>
