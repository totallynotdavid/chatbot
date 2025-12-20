<script lang="ts">
import { onMount } from "svelte";
import { user } from "$lib/state.svelte";
import type { Product } from "@totem/types";

let products = $state<Product[]>([]);
let showForm = $state(false);

// Form state
let name = $state("");
let price = $state("");
let installments = $state("");
let segment = $state("fnb");
let category = $state("");
let description = $state("");
let mainImageFiles: FileList | undefined = $state();
let specsImageFiles: FileList | undefined = $state();

// Extraction state
let isExtracting = $state(false);
let extractionError = $state("");
let extractionSuccess = $state(false);

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
    }
}

async function extractData() {
    const mainFile = mainImageFiles?.[0];
    if (!mainFile) {
        extractionError = "Debes seleccionar al menos el flyer principal";
        return;
    }

    isExtracting = true;
    extractionError = "";
    extractionSuccess = false;

    try {
        const form = new FormData();
        form.append("mainImage", mainFile);
        
        const specsFile = specsImageFiles?.[0];
        if (specsFile) {
            form.append("specsImage", specsFile);
        }

        const res = await fetch("/api/catalog/extract-preview", {
            method: "POST",
            body: form,
        });

        if (res.ok) {
            const extracted = await res.json();
            
            // Pre-fill form with extracted data
            if (extracted.name) name = extracted.name;
            if (extracted.price) price = String(extracted.price);
            if (extracted.installments) installments = String(extracted.installments);
            if (extracted.category) category = extracted.category;
            if (extracted.description) description = extracted.description;

            extractionSuccess = true;
            setTimeout(() => {
                extractionSuccess = false;
            }, 3000);
        } else {
            extractionError = "No se pudo extraer los datos. Completa manualmente.";
        }
    } catch (error) {
        console.error("Extraction error:", error);
        extractionError = "Error al procesar las imágenes. Intenta nuevamente.";
    } finally {
        isExtracting = false;
    }
}

async function upload() {
    const file = mainImageFiles?.[0];
    if (!file) return;

    const form = new FormData();
    form.append("image", file);
    
    // Add specs image if provided
    const specsFile = specsImageFiles?.[0];
    if (specsFile) {
        form.append("specsImage", specsFile);
    }

    form.append("name", name);
    form.append("price", price);
    form.append("segment", segment);
    form.append("category", category);
    form.append("description", description);
    if (installments) form.append("installments", installments);

    const res = await fetch("/api/catalog", { method: "POST", body: form });

    if (res.ok) {
        showForm = false;
        name = "";
        price = "";
        installments = "";
        category = "";
        description = "";
        mainImageFiles = undefined;
        specsImageFiles = undefined;
        extractionError = "";
        extractionSuccess = false;
        await load();
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

<div class="page-container">
  <div class="module-header">
    <div>
      <span class="module-subtitle">Inventario</span>
      <h1 class="module-title">Catálogo de productos</h1>
    </div>

    <div class="flex gap-4">
      <button onclick={downloadReport} class="btn-secondary">Descargar reporte</button>
      {#if canEdit}
        <button onclick={() => (showForm = !showForm)} class="btn-primary">
          {showForm ? "Cerrar editor" : "Nuevo producto"}
        </button>
      {/if}
    </div>
  </div>

  {#if canEdit}
    <div class="mb-12 border-b border-ink-900/10 pb-8">
      <div class="flex items-center gap-6">
        <span class="text-sm font-bold uppercase tracking-wider text-ink-900">Importación masiva:</span>
        <label class="cursor-pointer border-b border-ink-900 text-ink-900 text-sm hover:opacity-50 transition-opacity">
          Seleccionar archivo CSV
          <input type="file" bind:files={csvFiles} accept=".csv" class="hidden" onchange={uploadCsv} />
        </label>
        <a href="https://squoosh.app" target="_blank" class="text-xs text-ink-400 hover:underline">
          Optimizar imágenes con Squoosh
        </a>
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
          <button onclick={() => (importResult = null)} class="underline mt-2 text-ink-600">Limpiar</button>
        </div>
      {/if}
    </div>

    {#if showForm}
      <div class="bg-white p-8 border border-cream-200 shadow-lg mb-12 max-w-2xl">
        <h3 class="text-xl font-serif mb-6">Agregar nuevo producto</h3>
        
        <div class="space-y-6">
          <!-- Images Section -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="input-group">
              <span class="input-label mb-2 block">Flyer principal (requerido)</span>
              <div class="relative group">
                <label 
                  for="main-image" 
                  class="flex flex-col items-center justify-center w-full h-32 border border-dashed border-ink-300 rounded-lg cursor-pointer hover:bg-ink-50 hover:border-ink-400 transition-all bg-white"
                >
                  {#if mainImageFiles?.[0]}
                      <div class="flex flex-col items-center justify-center p-4">
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 mb-2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                          <p class="text-sm font-medium text-ink-900 text-center truncate max-w-full px-4">{mainImageFiles[0].name}</p>
                          <p class="text-xs text-ink-500 mt-1 group-hover:text-ink-700 transition-colors">Clic o arrastrar para cambiar</p>
                      </div>
                  {:else}
                      <div class="flex flex-col items-center justify-center pt-5 pb-6 text-ink-400 group-hover:text-ink-600 transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-2 opacity-60 group-hover:opacity-100 transition-opacity"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                          <p class="text-xs text-center px-4 uppercase tracking-wider font-medium">
                              Subir imagen
                          </p>
                      </div>
                  {/if}
                </label>
                <input
                    id="main-image"
                    type="file"
                    bind:files={mainImageFiles}
                    class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    accept="image/*"
                />
              </div>
            </div>

            <div class="input-group">
              <span class="input-label mb-2 block">Flyer de especificaciones</span>
              <div class="relative group">
                <label 
                  for="specs-image" 
                  class="flex flex-col items-center justify-center w-full h-32 border border-dashed border-ink-300 rounded-lg cursor-pointer hover:bg-ink-50 hover:border-ink-400 transition-all bg-white"
                >
                  {#if specsImageFiles?.[0]}
                      <div class="flex flex-col items-center justify-center p-4">
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-600 mb-2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                          <p class="text-sm font-medium text-ink-900 text-center truncate max-w-full px-4">{specsImageFiles[0].name}</p>
                          <p class="text-xs text-ink-500 mt-1 group-hover:text-ink-700 transition-colors">Clic o arrastrar para cambiar</p>
                      </div>
                  {:else}
                      <div class="flex flex-col items-center justify-center pt-5 pb-6 text-ink-400 group-hover:text-ink-600 transition-colors">
                          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-2 opacity-60 group-hover:opacity-100 transition-opacity"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/></svg>
                          <p class="text-xs text-center px-4 uppercase tracking-wider font-medium">
                              Subir imagen
                          </p>
                      </div>
                  {/if}
                </label>
                <input
                    id="specs-image"
                    type="file"
                    bind:files={specsImageFiles}
                    class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    accept="image/*"
                />
              </div>
            </div>
          </div>

          <!-- Auto-fill Action -->
          {#if mainImageFiles?.[0]}
            <div class="flex flex-col gap-2">
              <button 
                onclick={extractData} 
                disabled={isExtracting}
                class="btn-secondary w-full flex items-center justify-center gap-2 py-3 border-dashed"
              >
                {#if isExtracting}
                  <span class="animate-spin">↻</span> Analizando imágenes...
                {:else}
                  Autocompletar datos
                {/if}
              </button>
              
              {#if extractionError}
                <p class="text-xs text-red-600 text-center">{extractionError}</p>
              {/if}
              {#if extractionSuccess}
                <p class="text-xs text-green-600 text-center">✓ Datos completados. Por favor verifica la información.</p>
              {/if}
            </div>
          {/if}

          <!-- Product Details -->
          <div class="input-group">
            <label for="product-name" class="input-label">Nombre del producto*</label>
            <input id="product-name" bind:value={name} class="input-field" placeholder="Ej. Cocina 4 hornillas" />
          </div>

          <div class="grid grid-cols-2 gap-8">
            <div class="input-group">
              <label for="product-price" class="input-label">Precio (S/)*</label>
              <input id="product-price" bind:value={price} type="number" step="0.01" class="input-field" placeholder="0.00" />
            </div>
            <div class="input-group">
              <label for="product-installments" class="input-label">Cuotas</label>
              <input id="product-installments" bind:value={installments} type="number" class="input-field" placeholder="12" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-8">
            <div class="input-group">
              <label for="product-segment" class="input-label">Segmento*</label>
              <select id="product-segment" bind:value={segment} class="input-select">
                <option value="fnb">Financiera (FNB)</option>
                <option value="gaso">Gasodomésticos</option>
              </select>
            </div>
            <div class="input-group">
              <label for="product-category" class="input-label">Categoría*</label>
              <input id="product-category" bind:value={category} class="input-field" placeholder="Ej. Cocinas, Celulares" />
            </div>
          </div>

          <div class="input-group">
            <label for="product-desc" class="input-label">Descripción</label>
            <textarea 
              id="product-desc" 
              bind:value={description} 
              class="input-field min-h-24" 
              placeholder="Especificaciones técnicas (opcional)"
            ></textarea>
          </div>

          <div class="pt-4 flex gap-4">
            <button onclick={upload} class="btn-primary flex-1" disabled={!name || !price || !mainImageFiles?.[0]}>
              Guardar producto
            </button>
            <button onclick={() => { showForm = false; }} class="btn-secondary">
              Cancelar
            </button>
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
          <img
            src={`/static/${p.image_main_path}`}
            alt={p.name}
            class="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-500"
            onerror={(e) => {
              const target = e.currentTarget;
              if (target instanceof HTMLImageElement) {
                target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Crect fill='%23f3f3ef' width='200' height='200'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' fill='%23888' font-size='14'%3ENo image%3C/text%3E%3C/svg%3E";
              }
            }}
          />
          <span class="absolute bottom-0 left-0 bg-white/90 backdrop-blur px-3 py-1 text-[10px] font-bold uppercase tracking-widest border-t border-r border-cream-200">
            {p.segment}
          </span>
        </div>
        <div>
          <h3 class="font-serif text-lg leading-tight mb-1">{p.name}</h3>
          <div class="flex justify-between items-baseline border-t border-ink-900/20 pt-2 mt-2">
            <span class="text-xs uppercase tracking-wider text-ink-400">{p.category}</span>
            <span class="font-mono text-sm font-bold">S/ {p.price.toFixed(2)}</span>
          </div>
          {#if p.installments}
            <div class="text-xs text-ink-400 mt-1">{p.installments} cuotas</div>
          {/if}
        </div>
      </div>
    {/each}

    {#if products.length === 0}
      <div class="col-span-full py-20 text-center text-ink-300">
        <p class="font-serif italic">No hay productos en el catálogo.</p>
      </div>
    {/if}
  </div>
</div>
