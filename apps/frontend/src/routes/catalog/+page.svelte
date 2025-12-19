<script lang="ts">
import { onMount } from "svelte";
import { user } from "$lib/state.svelte";
import type { Product } from "@totem/types";

let products = $state<Product[]>([]);
let showForm = $state(false);

// Form state
let name = $state("");
let price = $state("");
let segment = $state("fnb");
let category = $state("");
let files: FileList | undefined = $state();

// Bulk state
let csvFiles: FileList | undefined = $state();
let importResult = $state<{ successCount: number; errors: string[] } | null>(
    null,
);

let isAdmin = $derived(user.data?.role === "admin");

async function load() {
    const res = await fetch("/api/catalog");
    if (res.status === 401) user.logout();
    else products = await res.json();
}

async function upload() {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append("image", file);
    form.append("name", name);
    form.append("price", price);
    form.append("segment", segment);
    form.append("category", category);

    await fetch("/api/catalog", { method: "POST", body: form });
    showForm = false;
    load();
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
    importResult = await res.json();
    load();
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

onMount(load);
</script>

<div class="page-container">
    <div class="module-header">
        <div>
            <span class="module-subtitle">Inventario</span>
            <h1 class="module-title">Catálogo de productos</h1>
        </div>
        
        <div class="flex gap-4">
            <button onclick={downloadReport} class="btn-secondary">
                Descargar reporte
            </button>
            {#if isAdmin}
                <button onclick={() => showForm = !showForm} class="btn-primary">
                    {showForm ? 'Cerrar editor' : 'Nuevo producto'}
                </button>
            {/if}
        </div>
    </div>

    {#if isAdmin}
        <div class="mb-12 border-b border-ink-900/10 pb-8">
            <div class="flex items-center gap-6">
                <span class="text-sm font-bold uppercase tracking-wider text-ink-900">Importación masiva:</span>
                <label class="cursor-pointer border-b border-ink-900 text-ink-900 text-sm hover:opacity-50 transition-opacity">
                    Seleccionar archivo CSV
                    <input type="file" bind:files={csvFiles} accept=".csv" class="hidden" onchange={uploadCsv} />
                </label>
            </div>
            
            {#if importResult}
                <div class="mt-4 bg-cream-200 p-4 text-sm font-mono">
                    <p class="font-bold">Resultado: {importResult.successCount} ítems procesados.</p>
                    {#if importResult.errors.length > 0}
                        <ul class="text-red-600 mt-2 list-disc pl-4">
                            {#each importResult.errors as err}
                                <li>{err}</li>
                            {/each}
                        </ul>
                    {/if}
                    <button onclick={() => importResult = null} class="underline mt-2 text-ink-600">Limpiar</button>
                </div>
            {/if}
        </div>

        {#if showForm}
            <div class="bg-white p-8 border border-cream-200 shadow-lg mb-12 max-w-2xl">
                <h3 class="text-xl font-serif mb-6">Agregar nuevo ítem</h3>
                <div class="space-y-4">
                    <div class="input-group">
                        <label for="product-name" class="input-label">Nombre del producto</label>
                        <input id="product-name" bind:value={name} class="input-field" placeholder="Ej. Cocina 4 hornillas" />
                    </div>
                    
                    <div class="grid grid-cols-2 gap-8">
                        <div class="input-group">
                            <label for="product-price" class="input-label">Precio (PEN)</label>
                            <input id="product-price" bind:value={price} type="number" class="input-field" placeholder="0.00" />
                        </div>
                        <div class="input-group">
                            <label for="product-segment" class="input-label">Segmento</label>
                            <select id="product-segment" bind:value={segment} class="input-select">
                                <option value="fnb">Financiera (FNB)</option>
                                <option value="gaso">Gasodomésticos</option>
                            </select>
                        </div>
                    </div>

                    <div class="input-group">
                        <label for="product-category" class="input-label">Categoría</label>
                        <input id="product-category" bind:value={category} class="input-field" placeholder="Ej. Línea Blanca" />
                    </div>

                    <div class="input-group">
                        <label for="product-image" class="input-label">Imagen referencial</label>
                        <input id="product-image" type="file" bind:files class="block w-full text-sm text-ink-600 file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-ink-100 file:text-ink-700 hover:file:bg-ink-200 cursor-pointer" accept="image/*" />
                    </div>

                    <div class="pt-4">
                        <button onclick={upload} class="btn-primary w-full">Guardar en base de datos</button>
                    </div>
                </div>
            </div>
        {/if}
    {/if}

    <!-- Gallery -->
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8">
        {#each products as p}
            <div class="group">
                <div class="aspect-4/5 bg-white border border-cream-200 mb-4 overflow-hidden relative">
                    <img src={`/static/${p.image_main_path}`} alt={p.name} class="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500" />
                    <span class="absolute bottom-0 left-0 bg-white/90 backdrop-blur px-3 py-1 text-[10px] font-bold uppercase tracking-widest border-t border-r border-cream-200">
                        {p.segment}
                    </span>
                </div>
                <div>
                    <h3 class="font-serif text-lg leading-tight mb-1">{p.name}</h3>
                    <div class="flex justify-between items-baseline border-t border-ink-900/20 pt-2 mt-2">
                        <span class="text-xs uppercase tracking-wider text-ink-400">{p.category}</span>
                        <span class="font-mono text-sm font-bold">S/ {p.price}</span>
                    </div>
                </div>
            </div>
        {/each}
    </div>
</div>
