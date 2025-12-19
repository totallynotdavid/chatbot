<script lang="ts">
import { user } from "$lib/state.svelte";
import { onMount } from "svelte";

let dni = $state("");
let loading = $state(false);
let result = $state<any>(null);
let provider = $state<"fnb" | "gaso" | null>(null);
let error = $state("");
let healthStatus = $state<any>(null);
let providersChecked = $state<string[]>([]);
let providersUnavailable = $state<any>(null);

onMount(async () => {
    if (!user.isAuthenticated) {
        window.location.href = "/login";
    }
    await loadHealth();
});

async function loadHealth() {
    try {
        const res = await fetch("/api/health");
        if (res.ok) healthStatus = await res.json();
    } catch (err) {}
}

async function handleQuery() {
    if (!/^\d{8}$/.test(dni)) {
        error = "El DNI debe tener 8 dígitos";
        return;
    }
    loading = true;
    error = "";
    result = null;
    try {
        const res = await fetch(`/api/providers/${dni}`);
        const data = await res.json();
        if (!res.ok) {
            error = data.error || "Consulta fallida";
            return;
        }
        result = data.result;
        provider = data.provider;
        providersChecked = data.providersChecked || [];
        providersUnavailable = data.providersUnavailable;
    } catch (err) {
        error = "Error de conexión";
    } finally {
        loading = false;
        await loadHealth();
    }
}
</script>

<div class="p-8 md:p-12 max-w-4xl mx-auto">
    <div class="mb-12 border-b border-cream-200 pb-6 flex justify-between items-end">
        <div>
            <span class="text-xs font-bold tracking-widest uppercase text-ink-400 mb-2 block">Base de datos 03</span>
            <h1 class="text-4xl font-serif text-ink-900">Historial crediticio</h1>
        </div>

        {#if healthStatus}
             <div class="flex gap-4 text-xs font-mono">
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full {healthStatus.providers.fnb.available ? 'bg-green-500' : 'bg-red-500'}"></span>
                    <span>Sistema FNB</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full {healthStatus.providers.gaso.available ? 'bg-green-500' : 'bg-red-500'}"></span>
                    <span>Sistema Gaso</span>
                </div>
            </div>
        {/if}
    </div>

    <div class="bg-white p-8 border border-cream-200 shadow-sm mb-8">
        <label for="dni" class="block text-sm font-bold uppercase tracking-wider mb-4">Identificación del cliente</label>
        <div class="flex gap-4">
            <input
                id="dni"
                type="text"
                bind:value={dni}
                placeholder="DNI (ej. 12345678)"
                maxlength="8"
                class="input-field text-2xl font-mono tracking-widest"
                disabled={loading}
            />
            <button
                onclick={handleQuery}
                disabled={loading || !dni}
                class="btn-primary shrink-0 self-end mb-2"
            >
                {loading ? 'Escaneando...' : 'Consultar'}
            </button>
        </div>
        {#if error}
            <p class="mt-4 text-red-600 font-serif italic">{error}</p>
        {/if}
    </div>

    {#if result}
        <div class="bg-cream-50 border border-ink-900 p-8 relative overflow-hidden">
            <div class="absolute top-0 left-0 right-0 h-1 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAFklEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=')] opacity-20"></div>

            <div class="flex justify-between items-start mb-8">
                <div>
                    <h2 class="text-2xl font-serif font-bold">Reporte de elegibilidad</h2>
                    <p class="text-sm text-ink-600 font-mono mt-1">{new Date().toLocaleDateString()} — {new Date().toLocaleTimeString()}</p>
                </div>
                <div class={`px-4 py-2 border-2 text-sm font-bold uppercase tracking-widest ${result.eligible ? 'border-green-600 text-green-700' : 'border-red-600 text-red-700'}`}>
                    {result.eligible ? 'Aprobado' : 'Rechazado'}
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 font-mono text-sm border-t border-dashed border-ink-300 pt-8">
                <div>
                    <span class="block text-ink-400 text-xs uppercase mb-1">Nombre del cliente</span>
                    <span class="text-lg">{result.name || 'N/A'}</span>
                </div>
                <div>
                    <span class="block text-ink-400 text-xs uppercase mb-1">Proveedor origen</span>
                    <span class="text-lg">{provider === 'fnb' ? 'FNB (Retail)' : 'Gaso (Servicios)'}</span>
                </div>
                <div>
                    <span class="block text-ink-400 text-xs uppercase mb-1">Línea aprobada</span>
                    <span class="text-2xl font-bold">S/ {result.credit.toLocaleString('es-PE', { minimumFractionDigits: 2 })}</span>
                </div>
                 {#if provider === 'gaso' && result.nse !== undefined}
                <div>
                    <span class="block text-ink-400 text-xs uppercase mb-1">Nivel NSE</span>
                    <span class="text-lg">{result.nse}</span>
                </div>
                {/if}
            </div>

            {#if !result.eligible && result.reason}
                <div class="mt-8 bg-red-50 border-l-2 border-red-500 p-4">
                    <span class="block text-red-800 text-xs uppercase font-bold mb-1">Razón del rechazo</span>
                    <p class="text-red-900 font-serif italic">{result.reason}</p>
                </div>
            {/if}
            
            {#if providersUnavailable}
                <div class="mt-4 text-xs text-yellow-700 bg-yellow-50 p-2 text-center">
                    ⚠ Advertencia: Interrupción parcial del sistema detectada durante el escaneo.
                </div>
            {/if}
        </div>
    {/if}
</div>
