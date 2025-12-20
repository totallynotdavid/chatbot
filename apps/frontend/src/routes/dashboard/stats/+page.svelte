<script lang="ts">
import { onMount } from "svelte";
import { auth } from "$lib/state/auth.svelte";
import { fetchApi } from "$lib/utils/api";
import PageHeader from "$lib/components/shared/page-header.svelte";
import Button from "$lib/components/ui/button.svelte";
import MetricsGrid from "$lib/components/metrics/metrics-grid.svelte";
import ActivityLog from "$lib/components/metrics/activity-log.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";

let stats = $state<any>(null);
let events = $state<any[]>([]);
let loading = $state(true);

async function loadData() {
    loading = true;

    const [statsData, eventsData] = await Promise.all([
        fetchApi<{ stats: any }>("/api/analytics/funnel"),
        fetchApi<{ events: any[] }>("/api/analytics/events?limit=100"),
    ]);

    stats = statsData.stats;
    events = eventsData.events;
    loading = false;
}

function getFailureRate(): string {
    if (!stats || stats.dni_collected === 0) return "0.0";
    return ((stats.eligibility_failed / stats.dni_collected) * 100).toFixed(1);
}

onMount(() => {
    if (!auth.isAuthenticated) {
        window.location.href = "/login";
        return;
    }
    loadData();
});
</script>

<PageTitle title="Estadísticas" />

<div class="max-w-7xl mx-auto p-8 md:p-12 min-h-screen">
	<PageHeader title="Estadísticas" subtitle="Métricas operativas">
		{#snippet actions()}
			<Button variant="secondary" onclick={loadData}>Actualizar</Button>
		{/snippet}
	</PageHeader>

	{#if loading}
		<div class="flex items-center justify-center py-20">
			<p class="font-serif text-ink-400 italic">Cargando datos...</p>
		</div>
	{:else if stats}
		<MetricsGrid {stats} />

		<div class="bg-cream-100 border border-cream-200 p-6 mb-12">
			<h2 class="text-xl font-serif mb-4">Rechazos de elegibilidad</h2>
			<div class="grid grid-cols-2 gap-4 text-sm font-mono">
				<div class="flex justify-between border-b border-cream-200 pb-2">
					<span>Total rechazados:</span>
					<span class="font-bold text-red-700">{stats.eligibility_failed}</span>
				</div>
				<div class="flex justify-between border-b border-cream-200 pb-2">
					<span>Tasa de rechazo:</span>
					<span class="font-bold">{getFailureRate()}%</span>
				</div>
			</div>
		</div>

		<ActivityLog {events} />
	{/if}
</div>
