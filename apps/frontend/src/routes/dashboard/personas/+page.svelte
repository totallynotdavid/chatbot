<script lang="ts">
import { onMount } from "svelte";
import { fetchApi } from "$lib/utils/api";
import Button from "$lib/components/ui/button.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import type { TestPersona } from "@vendeya/types";

let personas = $state<TestPersona[]>([]);
let loading = $state(false);

async function loadPersonas() {
  loading = true;
  try {
    personas = await fetchApi<TestPersona[]>("/api/simulator/personas");
  } catch (error) {
    console.error("Failed to load personas:", error);
  } finally {
    loading = false;
  }
}

async function deletePersona(personaId: string) {
  if (!confirm("¿Eliminar esta persona de prueba?")) return;

  loading = true;
  try {
    await fetchApi(`/api/simulator/personas/${personaId}`, {
      method: "DELETE",
    });
    await loadPersonas();
  } catch (error) {
    console.error("Failed to delete persona:", error);
    alert("Error al eliminar persona");
  } finally {
    loading = false;
  }
}

onMount(() => {
  loadPersonas();
});
</script>

<PageTitle title="Perfiles de cliente" />

<div class="p-8 max-w-6xl mx-auto">
	<div class="flex items-center justify-between mb-8">
		<div>
			<h1 class="text-3xl font-serif text-ink-900 mb-2">Perfiles de cliente de prueba</h1>
			<p class="text-ink-500">Gestiona los perfiles de cliente utilizados para las simulaciones.</p>
		</div>
		<Button href="/dashboard/personas/create">
			Nueva persona
		</Button>
	</div>

	<div class="bg-white rounded-lg shadow-sm border border-ink-900/10 overflow-hidden">
		{#if loading && personas.length === 0}
			<div class="p-12 text-center text-ink-400">
				Cargando personas...
			</div>
		{:else if personas.length === 0}
			<div class="p-12 text-center text-ink-400">
				<p class="font-serif italic mb-4">No hay personas de prueba creadas.</p>
				<Button href="/dashboard/personas/create" variant="secondary">
					Crear primera persona
				</Button>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-left text-sm">
					<thead class="bg-cream-50 border-b border-ink-900/10 text-ink-500 font-mono uppercase text-xs tracking-wider">
						<tr>
							<th class="px-6 py-4 font-bold">Nombre</th>
							<th class="px-6 py-4 font-bold">Segmento</th>
							<th class="px-6 py-4 font-bold">Cliente</th>
							<th class="px-6 py-4 font-bold">Detalles</th>
							<th class="px-6 py-4 font-bold text-right">Acciones</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-ink-900/5">
						{#each personas as persona (persona.id)}
							<tr class="hover:bg-cream-50/50 transition-colors group">
								<td class="px-6 py-4">
									<div class="font-medium text-ink-900">{persona.name}</div>
									<div class="text-xs text-ink-500 mt-1 max-w-xs truncate">{persona.description}</div>
								</td>
								<td class="px-6 py-4">
									<span class="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-1 rounded bg-ink-100 text-ink-600">
										{persona.segment}
									</span>
								</td>
								<td class="px-6 py-4">
									<div class="text-ink-900">{persona.clientName}</div>
									<div class="text-xs text-ink-400 font-mono">DNI: {persona.dni}</div>
								</td>
								<td class="px-6 py-4 text-ink-600 font-mono text-xs">
									<div>Línea: S/ {persona.creditLine.toLocaleString()}</div>
									{#if persona.nse}
										<div>NSE: {persona.nse}</div>
									{/if}
								</td>
								<td class="px-6 py-4 text-right">
									<button
										onclick={() => deletePersona(persona.id)}
										disabled={loading}
										class="text-ink-400 hover:text-red-600 hover:bg-red-50 p-2 rounded transition-colors disabled:opacity-50"
										title="Eliminar persona"
									>
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<polyline points="3 6 5 6 21 6"></polyline>
											<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
										</svg>
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>
