<script lang="ts">
import { ApiError, fetchApi } from "$lib/utils/api";
import { validateDni } from "$lib/utils/validation";
import type { LookupResult, ProviderLookup } from "$lib/utils/provider-lookup";
import Input from "$lib/components/ui/input.svelte";
import Button from "$lib/components/ui/button.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import PageHeader from "$lib/components/shared/page-header.svelte";
import LookupResultCard from "$lib/components/providers/lookup-result.svelte";

let dni = $state("");
let loading = $state(false);
let result = $state<LookupResult | null>(null);
// Providers whose circuit breaker was closed for the last lookup. The lookup
// response is the only health the dashboard can reach, so the dots wait for one.
let providersChecked = $state<string[] | null>(null);
let error = $state("");

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
    const data = await fetchApi<ProviderLookup>(`/api/providers/${dni}`);
    result = data.result;
    providersChecked = data.providersChecked;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      error = "Esta consulta está reservada al personal de VendeYa.";
    } else {
      error = err instanceof Error ? err.message : "Error de conexión";
    }
  } finally {
    loading = false;
  }
}
</script>

<PageTitle title="Proveedores" />

<div class="p-8 md:p-12 max-w-7xl mx-auto">
	<PageHeader title="Historial crediticio" subtitle="Base de datos">
		{#snippet actions()}
			{#if providersChecked}
				<div class="flex gap-4 text-xs font-mono">
					<div class="flex items-center gap-2">
						<span class="w-2 h-2 rounded-full {providersChecked.includes('fnb') ? 'bg-green-500' : 'bg-red-500'}"></span>
						<span>Sistema FNB</span>
					</div>
					<div class="flex items-center gap-2">
						<span class="w-2 h-2 rounded-full {providersChecked.includes('gaso') ? 'bg-green-500' : 'bg-red-500'}"></span>
						<span>Sistema Gaso</span>
					</div>
				</div>
			{/if}
		{/snippet}
	</PageHeader>

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
		<LookupResultCard {result} />
	{/if}
</div>
