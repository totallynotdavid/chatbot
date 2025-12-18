<script lang="ts">
    import { onMount } from 'svelte';
    import { user } from '$lib/state.svelte';
    import type { Product } from '@totem/types';

    let products = $state<Product[]>([]);
    let showForm = $state(false);
    let name = $state('');
    let price = $state('');
    let segment = $state('fnb');
    let category = $state('');
    let files: FileList | undefined = $state();
    
    let csvFiles: FileList | undefined = $state();
    let importResult = $state<{successCount: number, errors: string[]} | null>(null);

    async function load() {
        const res = await fetch('/api/catalog');
        if (res.status === 401) user.logout();
        else products = await res.json();
    }

    async function upload() {
        if (!files || files.length === 0) return;
        const form = new FormData();
        form.append('image', files[0]);
        form.append('name', name);
        form.append('price', price);
        form.append('segment', segment);
        form.append('category', category);
        form.append('description', '');

        await fetch('/api/catalog', { method: 'POST', body: form });
        showForm = false;
        load();
    }

    async function downloadReport() {
        const res = await fetch('/api/reports/daily');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report-${new Date().toISOString().split('T')[0]}.xlsx`;
        a.click();
    }

    async function uploadCsv() {
        if (!csvFiles || csvFiles.length === 0) return;
        const form = new FormData();
        form.append('csv', csvFiles[0]);

        const res = await fetch('/api/catalog/bulk', { method: 'POST', body: form });
        importResult = await res.json();
        load();
    }

    onMount(load);
</script>

<div class="p-6">
    <div class="flex justify-between mb-6">
        <h1 class="text-2xl font-bold">Catálogo de productos</h1>
        <div class="flex gap-2">
            <button onclick={downloadReport} class="bg-gray-800 text-white px-4 py-2 rounded flex items-center gap-2">
                <span>📊</span> Reporte
            </button>
            <button onclick={() => showForm = !showForm} class="bg-green-600 text-white px-4 py-2 rounded">
                {showForm ? 'Cancelar' : 'Agregar producto'}
            </button>
        </div>
    </div>

    <div class="flex items-center gap-2 border p-2 rounded bg-white mb-6">
        <span class="text-sm pl-2 font-bold text-gray-600">Importar:</span>
        <input type="file" bind:files={csvFiles} accept=".csv" class="text-sm" />
        <button onclick={uploadCsv} class="bg-blue-800 text-white px-3 py-1 rounded text-sm">Subir CSV</button>
    </div>

    {#if importResult}
        <div class="mb-6 p-4 bg-gray-50 border rounded text-sm">
            <p class="font-bold text-green-700">Imported: {importResult.successCount} items</p>
            {#if importResult.errors.length > 0}
                <ul class="text-red-600 mt-2 list-disc pl-4">
                    {#each importResult.errors as err}
                        <li>{err}</li>
                    {/each}
                </ul>
            {/if}
            <button onclick={() => importResult = null} class="text-gray-500 underline mt-2">Descartar</button>
        </div>
    {/if}

    {#if showForm}
        <div class="bg-white p-4 mb-6 rounded shadow border">
            <div class="grid grid-cols-2 gap-4">
                <input bind:value={name} placeholder="Nombre del producto" class="border p-2 rounded" />
                <input bind:value={price} type="number" placeholder="Precio" class="border p-2 rounded" />
                <select bind:value={segment} class="border p-2 rounded">
                    <option value="fnb">FNB</option>
                    <option value="gaso">Gasodomestico</option>
                </select>
                <input bind:value={category} placeholder="Categoría" class="border p-2 rounded" />
                <input type="file" bind:files class="border p-2 rounded col-span-2" accept="image/*" />
            </div>
            <button onclick={upload} class="mt-4 bg-blue-600 text-white px-4 py-2 rounded">Guardar producto</button>
        </div>
    {/if}

    <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {#each products as p}
            <div class="bg-white border rounded shadow overflow-hidden">
                <img src={`/static/${p.image_main_path}`} alt={p.name} class="w-full h-48 object-cover" />
                <div class="p-4">
                    <h3 class="font-bold">{p.name}</h3>
                    <p class="text-gray-600">S/ {p.price}</p>
                    <span class="text-xs bg-gray-200 px-2 py-1 rounded">{p.segment}</span>
                </div>
            </div>
        {/each}
    </div>
</div>
