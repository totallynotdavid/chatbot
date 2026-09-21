<script lang="ts">
import type { LookupResult } from "$lib/utils/provider-lookup";
import { formatPrice, formatDate, formatTime } from "$lib/utils/formatters";
import Badge from "$lib/components/ui/badge.svelte";

type Props = {
  result: LookupResult;
};

let { result }: Props = $props();

const outcomes = {
  eligible: { label: "APROBADO", variant: "success", note: "" },
  not_eligible: {
    label: "RECHAZADO",
    variant: "error",
    note: "El cliente no califica para una línea de crédito.",
  },
  system_outage: {
    label: "SIN RESPUESTA",
    variant: "warning",
    note: "Ningún proveedor respondió. Intenta de nuevo más tarde.",
  },
  needs_human: {
    label: "REVISIÓN MANUAL",
    variant: "warning",
    note: "La consulta necesita revisión de una persona.",
  },
} as const;

// `error` is set when the backend could not run the check at all.
const outcome = $derived(
  result.error
    ? ({ label: "ERROR", variant: "error", note: result.error } as const)
    : outcomes[result.status ?? "needs_human"],
);

const segmentLabels = { fnb: "FNB (Retail)", gaso: "Gaso (Servicios)" };
</script>

<div class="bg-cream-50 border border-ink-900 p-8 relative overflow-hidden">
	<div class="flex justify-between items-start mb-8">
		<div>
			<h2 class="text-2xl font-serif font-bold">Reporte de elegibilidad</h2>
			<p class="text-sm text-ink-600 font-mono mt-1">
				{formatDate(new Date())} — {formatTime(new Date())}
			</p>
		</div>
		<Badge variant={outcome.variant} class="px-4 py-2 border-2 text-sm">
			{outcome.label}
		</Badge>
	</div>

	{#if result.status === "eligible"}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-8 font-mono text-sm border-t border-dashed border-ink-300 pt-8">
			<div>
				<span class="block text-ink-400 text-xs uppercase mb-1">Nombre del cliente</span>
				<span class="text-lg">{result.name || "N/A"}</span>
			</div>
			<div>
				<span class="block text-ink-400 text-xs uppercase mb-1">Segmento</span>
				<span class="text-lg">{result.segment ? segmentLabels[result.segment] : "N/A"}</span>
			</div>
			<div>
				<span class="block text-ink-400 text-xs uppercase mb-1">Línea aprobada</span>
				<span class="text-2xl font-bold">S/ {formatPrice(result.credit ?? 0)}</span>
			</div>
			{#if result.nse !== undefined}
				<div>
					<span class="block text-ink-400 text-xs uppercase mb-1">Nivel NSE</span>
					<span class="text-lg">{result.nse}</span>
				</div>
			{/if}
		</div>
	{:else}
		<div class="border-t border-dashed border-ink-300 pt-8">
			<p class="text-ink-900 font-serif italic">{outcome.note}</p>
		</div>
	{/if}
</div>
