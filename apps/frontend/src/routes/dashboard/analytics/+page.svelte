<script lang="ts">
import { onMount } from "svelte";
import { user } from "$lib/state.svelte";

let stats = $state<any>(null);
let events = $state<any[]>([]);
let loading = $state(true);

async function loadData() {
    loading = true;

    const [statsRes, eventsRes] = await Promise.all([
        fetch("/api/analytics/funnel"),
        fetch("/api/analytics/events?limit=100"),
    ]);

    if (statsRes.ok) {
        const data = await statsRes.json();
        stats = data.stats;
    }

    if (eventsRes.ok) {
        const data = await eventsRes.json();
        events = data.events;
    }

    loading = false;
}

onMount(() => {
    if (!user.isAuthenticated) {
        window.location.href = "/login";
        return;
    }
    loadData();
});

function getConversionRate() {
    if (!stats || stats.sessions_started === 0) return 0;
    return ((stats.products_offered / stats.sessions_started) * 100).toFixed(1);
}

function getEligibilityRate() {
    if (!stats || stats.dni_collected === 0) return 0;
    return ((stats.eligibility_passed / stats.dni_collected) * 100).toFixed(1);
}
</script>

<div class="page-container">
  <div class="module-header">
    <div>
      <span class="module-subtitle">Métricas operativas</span>
      <h1 class="module-title">Analytics</h1>
    </div>
    <button onclick={loadData} class="btn-secondary">
      Actualizar
    </button>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-20">
      <p class="font-serif text-ink-400 italic">Cargando datos...</p>
    </div>
  {:else if stats}
    <!-- Funnel Overview -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
      <div class="bg-white border border-cream-200 p-6">
        <span class="text-xs font-bold uppercase tracking-widest text-ink-400 block mb-2">Sesiones iniciadas</span>
        <span class="text-4xl font-serif font-bold">{stats.sessions_started}</span>
      </div>

      <div class="bg-white border border-cream-200 p-6">
        <span class="text-xs font-bold uppercase tracking-widest text-ink-400 block mb-2">DNI recolectados</span>
        <span class="text-4xl font-serif font-bold">{stats.dni_collected}</span>
      </div>

      <div class="bg-white border border-cream-200 p-6">
        <span class="text-xs font-bold uppercase tracking-widest text-ink-400 block mb-2">Elegibles</span>
        <span class="text-4xl font-serif font-bold text-green-700">{stats.eligibility_passed}</span>
        <span class="text-xs text-ink-400 mt-1 block">{getEligibilityRate()}% del total</span>
      </div>

      <div class="bg-white border border-cream-200 p-6">
        <span class="text-xs font-bold uppercase tracking-widest text-ink-400 block mb-2">Productos ofrecidos</span>
        <span class="text-4xl font-serif font-bold text-blue-700">{stats.products_offered}</span>
        <span class="text-xs text-ink-400 mt-1 block">{getConversionRate()}% conversión</span>
      </div>
    </div>

    <!-- Failures Breakdown -->
    <div class="bg-cream-100 border border-cream-200 p-6 mb-12">
      <h2 class="text-xl font-serif mb-4">Rechazos de elegibilidad</h2>
      <div class="grid grid-cols-2 gap-4 text-sm font-mono">
        <div class="flex justify-between border-b border-cream-200 pb-2">
          <span>Total rechazados:</span>
          <span class="font-bold text-red-700">{stats.eligibility_failed}</span>
        </div>
        <div class="flex justify-between border-b border-cream-200 pb-2">
          <span>Tasa de rechazo:</span>
          <span class="font-bold">{stats.dni_collected > 0 ? ((stats.eligibility_failed / stats.dni_collected) * 100).toFixed(1) : 0}%</span>
        </div>
      </div>
    </div>

    <!-- Recent Events Log -->
    <div class="bg-white border border-cream-200 shadow-sm">
      <div class="border-b border-cream-200 p-6">
        <h2 class="text-2xl font-serif">Eventos recientes</h2>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-cream-100 font-mono text-xs uppercase tracking-wider">
            <tr>
              <th class="text-left p-4">Timestamp</th>
              <th class="text-left p-4">Teléfono</th>
              <th class="text-left p-4">Evento</th>
              <th class="text-left p-4">Metadata</th>
            </tr>
          </thead>
          <tbody class="font-mono text-xs">
            {#each events as event}
              <tr class="border-b border-cream-100 hover:bg-cream-50">
                <td class="p-4 text-ink-400">{new Date(event.created_at).toLocaleString()}</td>
                <td class="p-4">{event.phone_number}</td>
                <td class="p-4">
                  <span class={`px-2 py-1 text-[10px] font-bold ${
                    event.event_type.includes('failed') ? 'bg-red-100 text-red-800' :
                    event.event_type.includes('passed') ? 'bg-green-100 text-green-800' :
                    'bg-ink-100 text-ink-800'
                  }`}>
                    {event.event_type}
                  </span>
                </td>
                <td class="p-4 text-ink-400 max-w-xs truncate">{event.metadata || '{}'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}
</div>
