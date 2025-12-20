<script lang="ts">
import type { Product, StockStatus } from "@totem/types";
import ProductCard from "./product-card.svelte";

type Props = {
	products: Product[];
	canEdit: boolean;
	onProductClick?: (product: Product) => void;
	onStockUpdate: (productId: string, newStatus: StockStatus) => void;
};

let { products, canEdit, onProductClick, onStockUpdate }: Props = $props();
</script>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
	{#each products as product (product.id)}
		<ProductCard
			{product}
			{canEdit}
			onclick={() => onProductClick?.(product)}
			onStockUpdate={(newStatus) => onStockUpdate(product.id, newStatus)}
		/>
	{/each}

	{#if products.length === 0}
		<div class="col-span-full py-20 text-center text-ink-300">
			<p class="font-serif italic text-xl">No hay productos en el catálogo.</p>
		</div>
	{/if}
</div>
