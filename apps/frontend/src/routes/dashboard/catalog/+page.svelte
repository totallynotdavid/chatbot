<script lang="ts">
import { onMount } from "svelte";
import type { Product, StockStatus } from "@totem/types";
import { auth } from "$lib/state/auth.svelte";
import { catalogSelection } from "$lib/state/catalog.svelte";
import { fetchApi } from "$lib/utils/api";
import PageHeader from "$lib/components/shared/page-header.svelte";
import Button from "$lib/components/ui/button.svelte";
import ProductGrid from "$lib/components/catalog/product-grid.svelte";
import ProductModal from "$lib/components/catalog/product-modal.svelte";
import BulkActionsPanel from "$lib/components/catalog/bulk-actions-panel.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

let localProducts = $state<Product[]>([]);
let selectedProduct = $state<Product | null>(null);
let showModal = $state(false);

let products = $derived(
  localProducts.length > 0 ? localProducts : data.products,
);

let selectedProducts = $derived(
  products.filter((p: Product) => catalogSelection.isSelected(p.id)),
);

async function loadProducts() {
  try {
    localProducts = await fetchApi<Product[]>("/api/catalog");
    catalogSelection.clear();
  } catch (error) {
    console.error("Failed to load products:", error);
  }
}

function handleProductClick(product: Product) {
  if (auth.canEdit) {
    selectedProduct = product;
    showModal = true;
  }
}

function handleStockUpdate(productId: string, newStatus: StockStatus) {
  const product = products.find((p: Product) => p.id === productId);
  if (product) {
    product.stock_status = newStatus;
    products = [...products];
  }
}

function openCreateModal() {
  selectedProduct = null;
  showModal = true;
}

onMount(() => {
  if (!data.user) {
    window.location.href = "/login";
    return;
  }
  loadProducts();
});
</script>

<PageTitle title="Catálogo" />

<div class="max-w-7xl mx-auto p-8 md:p-12 min-h-screen">
	<PageHeader title="Catálogo de productos" subtitle="Inventario">
		{#snippet actions()}
			{#if auth.canEdit}
				<Button onclick={openCreateModal}>Nuevo producto</Button>
			{/if}
		{/snippet}
	</PageHeader>

	<ProductGrid
		{products}
		canEdit={auth.canEdit}
		onProductClick={handleProductClick}
		onStockUpdate={handleStockUpdate}
	/>
</div>

{#if showModal}
	<ProductModal
		product={selectedProduct}
		open={true}
		onClose={() => showModal = false}
		onSuccess={loadProducts}
	/>
{/if}

{#if catalogSelection.selectedCount > 0 && auth.canEdit}
	<BulkActionsPanel
		{selectedProducts}
		onClose={() => catalogSelection.clear()}
		onSuccess={loadProducts}
	/>
{/if}
