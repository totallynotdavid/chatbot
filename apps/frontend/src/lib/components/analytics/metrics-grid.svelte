<script lang="ts">
import MetricCard from "./metric-card.svelte";

type Stats = {
	sessions_started: number;
	dni_collected: number;
	eligibility_passed: number;
	eligibility_failed: number;
	products_offered: number;
};

type Props = {
	stats: Stats;
};

let { stats }: Props = $props();

function getConversionRate(): string {
	if (stats.sessions_started === 0) return "0.0";
	return ((stats.products_offered / stats.sessions_started) * 100).toFixed(1);
}

function getEligibilityRate(): string {
	if (stats.dni_collected === 0) return "0.0";
	return ((stats.eligibility_passed / stats.dni_collected) * 100).toFixed(1);
}
</script>

<div class="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
	<MetricCard label="Sesiones iniciadas" value={stats.sessions_started} />
	<MetricCard label="DNI recolectados" value={stats.dni_collected} />
	<MetricCard
		label="Elegibles"
		value={stats.eligibility_passed}
		subtitle="{getEligibilityRate()}% del total"
		variant="success"
	/>
	<MetricCard
		label="Productos ofrecidos"
		value={stats.products_offered}
		subtitle="{getConversionRate()}% conversión"
		variant="warning"
	/>
</div>
