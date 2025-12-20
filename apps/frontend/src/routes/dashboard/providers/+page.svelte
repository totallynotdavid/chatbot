<script lang="ts">
import { onMount } from "svelte";
import { auth } from "$lib/state/auth.svelte";
import { fetchApi } from "$lib/utils/api";
import { validateDni } from "$lib/utils/validation";
import { formatPrice } from "$lib/utils/formatters";
import Input from "$lib/components/ui/input.svelte";
import Button from "$lib/components/ui/button.svelte";
import Badge from "$lib/components/ui/badge.svelte";

let dni = $state("");
let loading = $state(false);
let result = $state<any>(null);
let provider = $state<"fnb" | "gaso" | null>(null);
let error = $state("");
let healthStatus = $state<any>(null);

async function loadHealth() {
    try {
        healthStatus = await fetchApi<any>("/api/health");
    } catch (err) {
        console.error("Health check failed:", err);
    }
}

async function handleQuery() {
    const dniError = validateDni(dni);
    if (dniError) {
        error = dniError;
        return;
    }

    loading = true;
    error = "";
    result = null;

    try {
        const data = await fetchApi<any>(`/api/providers/${dni}`);
        result = data.result;
        provider = data.provider;
    } catch (err) {
        error = err instanceof Error ? err.message : "Error de conexión";
    } finally {
        loading = false;
        await loadHealth();
    }
}

onMount(async () => {
    if (!auth.isAuthenticated) {
        window.location.href = "/login";
    }
    await loadHealth();
});
</script>

<div class="p-8 md:p-12 max-w-4xl mx-auto">
	<div class="mb-12 border-b border-cream-200 pb-6 flex justify-between items-end">
		<div>
			<span class="text-xs font-bold tracking-widest uppercase text-ink-400 mb-2 block">
				Base de datos 03
			</span>
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
		<label for="dni" class="block text-sm font-bold uppercase tracking-wider mb-4">
			Identificación del cliente
		</label>
		<div class="flex gap-4">
			<Input
				id="dni"
				bind:value={dni}
				disabled={loading}
				placeholder="DNI (ej. 12345678)"
				class="text-2xl font-mono tracking-widest"
			/>
			<Button onclick={handleQuery} disabled={loading || !dni} class="shrink-0 self-end mb-2">
				{loading ? "Escaneando..." : "Consultar"}
			</Button>
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
					<p class="text-sm text-ink-600 font-mono mt-1">
						{new Date().toLocaleDateString()} — {new Date().toLocaleTimeString()}
					</p>
				</div>
				<Badge variant={result.eligible ? "success" : "error"} class="px-4 py-2 border-2 text-sm">
					{result.eligible ? "APROBADO" : "RECHAZADO"}
				</Badge>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-8 font-mono text-sm border-t border-dashed border-ink-300 pt-8">
				<div>
					<span class="block text-ink-400 text-xs uppercase mb-1">Nombre del cliente</span>
					<span class="text-lg">{result.name || "N/A"}</span>
				</div>
				<div>
					<span class="block text-ink-400 text-xs uppercase mb-1">Proveedor origen</span>
					<span class="text-lg">
						{provider === "fnb" ? "FNB (Retail)" : provider === "gaso" ? "Gaso (Servicios)" : "N/A"}
					</span>
				</div>
				<div>
					<span class="block text-ink-400 text-xs uppercase mb-1">Línea aprobada</span>
					<span class="text-2xl font-bold">S/ {formatPrice(result.credit)}</span>
				</div>
				{#if provider === "gaso" && result.nse !== undefined}
					<div>
						<span class="block text-ink-400 text-xs uppercase mb-1">Nivel NSE</span>
						<span class="text-lg">{result.nse}</span>
					</div>
				{/if}
			</div>

			{#if !result.eligible && result.reason}
				<div class="mt-8 bg-red-50 border-l-2 border-red-500 p-4">
					<span class="block text-red-800 text-xs uppercase font-bold mb-1">
						Razón del rechazo
					</span>
					<p class="text-red-900 font-serif italic">{result.reason}</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
