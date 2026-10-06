<script lang="ts">
import { goto } from "$app/navigation";
import { fetchApi } from "#lib/utils/api.js";
import Button from "#lib/components/ui/button.svelte";
import PageTitle from "#lib/components/shared/page-title.svelte";

let loading = $state(false);
let newPersona = $state({
  id: "",
  name: "",
  description: "",
  segment: "fnb" as "fnb" | "gaso" | "not_eligible",
  clientName: "",
  dni: "",
  creditLine: 0,
  nse: undefined as number | undefined,
});

async function createPersona() {
  loading = true;
  try {
    await fetchApi("/api/simulator/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newPersona),
    });
    goto("/dashboard/personas");
  } catch (error) {
    console.error("Failed to create persona:", error);
    alert("Error al crear persona");
  } finally {
    loading = false;
  }
}
</script>

<PageTitle title="Crear persona" />

<div class="p-8 max-w-6xl mx-auto">
	<div class="mb-8">
		<h1 class="text-3xl font-serif text-ink-900">Crear persona de prueba</h1>
		<p class="text-ink-500 mt-2">Define un nuevo perfil de cliente para utilizar en las simulaciones.</p>
	</div>

	<div class="bg-white rounded-lg shadow-sm border border-ink-900/10 p-8 max-w-3xl">
		<div class="space-y-6">
			<div>
				<label for="persona-id" class="block text-sm font-medium text-ink-700 mb-1">
					ID <span class="text-red-500">*</span>
				</label>
				<input
					id="persona-id"
					type="text"
					bind:value={newPersona.id}
					placeholder="fnb_test_1"
					class="w-full px-3 py-2 border border-ink-900/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
				/>
				<p class="text-xs text-ink-500 mt-1">Identificador único (sin espacios, usar guiones bajos)</p>
			</div>

			<div>
				<label for="persona-name" class="block text-sm font-medium text-ink-700 mb-1">
					Nombre <span class="text-red-500">*</span>
				</label>
				<input
					id="persona-name"
					type="text"
					bind:value={newPersona.name}
					placeholder="FNB - Crédito Test"
					class="w-full px-3 py-2 border border-ink-900/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
				/>
			</div>

			<div>
				<label for="persona-description" class="block text-sm font-medium text-ink-700 mb-1">
					Descripción <span class="text-red-500">*</span>
				</label>
				<textarea
					id="persona-description"
					bind:value={newPersona.description}
					placeholder="Cliente de prueba con características específicas..."
					rows="3"
					class="w-full px-3 py-2 border border-ink-900/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
				></textarea>
			</div>

			<div>
				<label for="persona-segment" class="block text-sm font-medium text-ink-700 mb-1">
					Segmento <span class="text-red-500">*</span>
				</label>
				<select
					id="persona-segment"
					bind:value={newPersona.segment}
					class="w-full px-3 py-2 border border-ink-900/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
				>
					<option value="fnb">FNB</option>
					<option value="gaso">GASO</option>
					<option value="not_eligible">No Elegible</option>
				</select>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div>
					<label for="persona-client-name" class="block text-sm font-medium text-ink-700 mb-1">
						Nombre cliente <span class="text-red-500">*</span>
					</label>
					<input
						id="persona-client-name"
						type="text"
						bind:value={newPersona.clientName}
						placeholder="JUAN PEREZ LOPEZ"
						class="w-full px-3 py-2 border border-ink-900/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
					/>
				</div>

				<div>
					<label for="persona-dni" class="block text-sm font-medium text-ink-700 mb-1">
						DNI <span class="text-red-500">*</span>
					</label>
					<input
						id="persona-dni"
						type="text"
						bind:value={newPersona.dni}
						placeholder="12345678"
						maxlength="8"
						class="w-full px-3 py-2 border border-ink-900/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
					/>
				</div>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
				<div>
					<label for="persona-credit" class="block text-sm font-medium text-ink-700 mb-1">
						Línea de crédito <span class="text-red-500">*</span>
					</label>
					<input
						id="persona-credit"
						type="number"
						bind:value={newPersona.creditLine}
						placeholder="3000"
						min="0"
						step="100"
						class="w-full px-3 py-2 border border-ink-900/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
					/>
				</div>

				<div>
					<label for="persona-nse" class="block text-sm font-medium text-ink-700 mb-1">
						NSE (opcional)
					</label>
					<input
						id="persona-nse"
						type="number"
						bind:value={newPersona.nse}
						placeholder="1, 2, o 3"
						min="1"
						max="3"
						class="w-full px-3 py-2 border border-ink-900/20 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
					/>
				</div>
			</div>

			<div class="pt-6 border-t border-ink-900/10 flex justify-end gap-3">
				<Button variant="secondary" href="/dashboard/personas">
					Cancelar
				</Button>
				<Button onclick={createPersona} disabled={loading || !newPersona.id || !newPersona.name || !newPersona.description || !newPersona.clientName || !newPersona.dni}>
					{loading ? 'Creando...' : 'Crear persona'}
				</Button>
			</div>
		</div>
	</div>
</div>
