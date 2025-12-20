<script lang="ts">
import { onMount } from "svelte";
import { user } from "$lib/state.svelte";
import Toast from "$lib/components/Toast.svelte";
import StockStatusBadge from "$lib/components/StockStatusBadge.svelte";
import ProductEditModal from "$lib/components/ProductEditModal.svelte";
import BulkActionsPanel from "$lib/components/BulkActionsPanel.svelte";
import type { Product, StockStatus } from "@totem/types";

let products = $state<Product[]>([]);
let showModal = $state(false);

// Edit modal state
let editingProduct = $state<Product | null>(null);

// Bulk selection state
let selectedProductIds = $state<Set<string>>(new Set());
let showBulkPanel = $derived(selectedProductIds.size > 0);

// Computed values
let selectedProducts = $derived(
    products.filter((p) => selectedProductIds.has(p.id)),
);

// Bulk state
let csvFiles: FileList | undefined = $state();
let importResult = $state<{ successCount: number; errors: string[] } | null>(
    null,
);

let canEdit = $derived(
    user.data?.role === "admin" || user.data?.role === "developer",
);

async function load() {
    const res = await fetch("/api/catalog");
    if (res.status === 401) {
        user.logout();
        return;
    }
    if (res.ok) {
        products = await res.json();
        selectedProductIds.clear();
    }
}

function toggleProductSelection(productId: string) {
    if (selectedProductIds.has(productId)) {
        selectedProductIds.delete(productId);
    } else {
        selectedProductIds.add(productId);
    }
    selectedProductIds = selectedProductIds;
}

function toggleSelectAll() {
    if (selectedProductIds.size === products.length) {
        selectedProductIds.clear();
    } else {
        selectedProductIds = new Set(products.map((p) => p.id));
    }
}

function handleStockUpdate(productId: string, newStatus: StockStatus) {
    const product = products.find((p) => p.id === productId);
    if (product) {
        product.stock_status = newStatus;
        products = [...products];
    }
}

function handleProductUpdate(updated: Product) {
    const index = products.findIndex((p) => p.id === updated.id);
    if (index !== -1) {
        products[index] = updated;
        products = [...products];
    } else {
        // New product
        products = [updated, ...products];
    }
}

async function uploadCsv() {
    const csvFile = csvFiles?.[0];
    if (!csvFile) return;

    const form = new FormData();
    form.append("csv", csvFile);

    const res = await fetch("/api/catalog/bulk", {
        method: "POST",
        body: form,
    });
    if (res.ok) {
        importResult = await res.json();
        await load();
    }
}

async function downloadReport() {
    const res = await fetch("/api/reports/daily");
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-${new Date().toISOString().split("T")[0]}.xlsx`;
    a.click();
}

onMount(() => {
    if (!user.isAuthenticated) {
        window.location.href = "/login";
        return;
    }
    load();
});
</script>

<Toast />

<div class="page-container">
  <div class="module-header">
    <div>
      <span class="module-subtitle">Inventario</span>
      <h1 class="module-title">Catálogo de productos</h1>
    </div>

    <div class="flex gap-4">
      <button onclick={downloadReport} class="btn-secondary rounded-full px-6">Descargar reporte</button>
      {#if canEdit}
        <button onclick={() => { editingProduct = null; showModal = true; }} class="btn-primary rounded-full px-6">
          Nuevo producto
        </button>
      {/if}
    </div>
  </div>

  {#if canEdit}
    <!-- Hidden file input for bulk import, triggered programmatically if needed later -->
    <input type="file" bind:files={csvFiles} accept=".csv" class="hidden" onchange={uploadCsv} id="csv-upload" />

    {#if importResult}
        <div class="mb-8 bg-cream-100 border border-ink-200 p-4 text-sm rounded-lg">
          <p class="font-bold">Resultado: {importResult.successCount} ítems procesados.</p>
          {#if importResult.errors.length > 0}
            <ul class="text-red-600 mt-2 list-disc pl-4">
              {#each importResult.errors as err}
                <li>{err}</li>
              {/each}
            </ul>
          {/if}
          <button onclick={() => (importResult = null)} class="underline mt-2 text-ink-600">Limpiar</button>
        </div>
    {/if}


  {/if}

  <!-- Gallery -->
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
    {#each products as p}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div 
        class="group product-card flex flex-col h-full relative bg-white hover:bg-cream-50 p-4 transition-all duration-300 cursor-pointer border border-transparent hover:border-ink-200" 
        class:selected={selectedProductIds.has(p.id)}
        onclick={() => { if(canEdit) { editingProduct = p; showModal = true; } }}
      >
        <!-- Card Content -->
        <div class="flex flex-col h-full">
            <!-- Image -->
            <div class="aspect-square w-full bg-white mb-3 overflow-hidden relative mix-blend-multiply">
                 <img
                    src={`/static/${p.image_main_path}`}
                    alt={p.name}
                    class="w-full h-full object-contain transition-transform duration-500 ease-out"
                    onerror={(e) => {
                      const target = e.currentTarget;
                      if (target instanceof HTMLImageElement) {
                        target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23f3f3ef' width='200' height='200'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' fill='%23888' font-size='14'%3ENo image%3C/text%3E%3C/svg%3E";
                      }
                    }}
                  />
                  {#if p.is_active === 0}
                    <div class="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex items-center justify-center">
                      <span class="text-ink-400 font-bold uppercase text-xs tracking-wider border border-ink-200 px-2 py-1">Inactivo</span>
                    </div>
                  {/if}
            </div>

            <!-- Header -->
            <div class="flex justify-between items-center mb-4">
                <span class="text-[10px] font-bold uppercase tracking-widest text-ink-400">{p.category}</span>
                <div onclick={(e) => e.stopPropagation()} role="presentation">
                    <StockStatusBadge
                    productId={p.id}
                    productName={p.name}
                    stockStatus={p.stock_status}
                    canEdit={canEdit}
                    onUpdate={(newStatus) => handleStockUpdate(p.id, newStatus)}
                    />
                </div>
            </div>

            <!-- Title -->
            <div class="flex justify-between items-start gap-2 mb-2">
                <h3 class="font-serif text-lg leading-tight text-ink-900">{p.name}</h3>
            </div>

            <!-- Footer -->
            <div class="mt-auto pt-3 border-t border-ink-900/5 flex items-baseline justify-between">
                <p class="font-mono text-lg text-ink-900">S/ {p.price.toFixed(2)}</p>
                {#if p.installments}
                    <p class="text-[10px] text-ink-400 uppercase tracking-wider">{p.installments} cuotas</p>
                {/if}
            </div>
        </div>
      </div>
    {/each}

    {#if products.length === 0}
      <div class="col-span-full py-20 text-center text-ink-300">
        <p class="font-serif italic text-xl">No hay productos en el catálogo.</p>
      </div>
    {/if}
  </div>
</div>

{#if showModal}
  <ProductEditModal
    product={editingProduct}
    isOpen={true}
    onClose={() => (showModal = false)}
    onUpdate={handleProductUpdate}
  />
{/if}

{#if showBulkPanel && canEdit}
  <BulkActionsPanel
    selectedProducts={selectedProducts}
    onClose={() => selectedProductIds.clear()}
    onUpdate={load}
  />
{/if}

<style>
.product-card {
    position: relative;
}

.product-card.selected img {
    opacity: 0.8;
}
</style>
