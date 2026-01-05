<script lang="ts">
import PageHeader from "$lib/components/shared/page-header.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import Button from "$lib/components/ui/button.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

// Form state
let startDate = $state(new Date().toISOString().split("T")[0]);
let endDate = $state(new Date().toISOString().split("T")[0]);
let segmentFnb = $state(true);
let segmentGaso = $state(true);
let segmentNone = $state(true);
let saleStatusAll = $state(true);
let saleStatusConfirmed = $state(false);
let saleStatusPending = $state(false);
let saleStatusRejected = $state(false);
let generating = $state(false);

function setQuickDate(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  startDate = start.toISOString().split("T")[0];
  endDate = end.toISOString().split("T")[0];
}

function setToday() {
  const today = new Date().toISOString().split("T")[0];
  startDate = today;
  endDate = today;
}

function setYesterday() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().split("T")[0];
  startDate = date;
  endDate = date;
}

async function generateReport() {
  generating = true;

  const segments: string[] = [];
  if (segmentFnb) segments.push("fnb");
  if (segmentGaso) segments.push("gaso");
  if (segmentNone) segments.push("none");

  const saleStatuses: string[] = [];
  if (saleStatusAll) {
    saleStatuses.push("all");
  } else {
    if (saleStatusConfirmed) saleStatuses.push("confirmed");
    if (saleStatusPending) saleStatuses.push("pending");
    if (saleStatusRejected) saleStatuses.push("rejected");
  }

  const params = new URLSearchParams({
    startDate: startDate,
    endDate: endDate,
    segments: segments.join(","),
    saleStatuses: saleStatuses.join(","),
  } as Record<string, string>);

  try {
    const res = await fetch(`/api/reports/activity?${params}`);
    if (!res.ok) throw new Error("Failed to generate report");

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-actividad-${startDate}-a-${endDate}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Failed to generate report:", error);
  } finally {
    generating = false;
  }
}

function handleSaleStatusChange(status: string) {
  if (status === "all") {
    saleStatusAll = true;
    saleStatusConfirmed = false;
    saleStatusPending = false;
    saleStatusRejected = false;
  } else {
    saleStatusAll = false;
  }
}
</script>

<PageTitle title="Reportes" />

<div class="max-w-4xl mx-auto p-8 md:p-12 min-h-screen">
  <PageHeader title="Reportes" subtitle="Exportación de datos" />

  <div class="bg-white border border-cream-200 p-8">
    <h2 class="font-serif text-2xl mb-2">Reporte de actividad diaria</h2>
    <p class="text-ink-400 text-sm mb-8">
      Exporta todos los contactos gestionados con sus datos recopilados.
      Este reporte incluye todos los clientes que contactaron al bot,
      independientemente del resultado de la venta.
    </p>

    <div class="space-y-8">
      <!-- Date Range -->
      <div>
        <h3 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-3">
          Período
        </h3>
        <div class="flex flex-wrap gap-3 mb-4">
          <button
            onclick={setToday}
            class="px-4 py-2 text-xs font-medium border border-ink-200 hover:border-ink-900 hover:bg-ink-50 transition-colors"
          >
            Hoy
          </button>
          <button
            onclick={setYesterday}
            class="px-4 py-2 text-xs font-medium border border-ink-200 hover:border-ink-900 hover:bg-ink-50 transition-colors"
          >
            Ayer
          </button>
          <button
            onclick={() => setQuickDate(7)}
            class="px-4 py-2 text-xs font-medium border border-ink-200 hover:border-ink-900 hover:bg-ink-50 transition-colors"
          >
            Últimos 7 días
          </button>
          <button
            onclick={() => setQuickDate(30)}
            class="px-4 py-2 text-xs font-medium border border-ink-200 hover:border-ink-900 hover:bg-ink-50 transition-colors"
          >
            Últimos 30 días
          </button>
        </div>
        <div class="flex gap-4 items-center">
          <div>
            <label for="start-date" class="block text-xs text-ink-400 mb-1">Desde</label>
            <input
              id="start-date"
              type="date"
              bind:value={startDate}
              class="px-4 py-2 border border-ink-200 font-mono text-sm focus:outline-none focus:border-ink-900"
            />
          </div>
          <span class="text-ink-300 mt-5">—</span>
          <div>
            <label for="end-date" class="block text-xs text-ink-400 mb-1">Hasta</label>
            <input
              id="end-date"
              type="date"
              bind:value={endDate}
              class="px-4 py-2 border border-ink-200 font-mono text-sm focus:outline-none focus:border-ink-900"
            />
          </div>
        </div>
      </div>

      <!-- Segment Filter -->
      <div>
        <h3 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-3">
          Segmento
        </h3>
        <div class="flex flex-wrap gap-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={segmentFnb}
              class="w-4 h-4 accent-ink-900"
            />
            <span class="text-sm">FNB</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={segmentGaso}
              class="w-4 h-4 accent-ink-900"
            />
            <span class="text-sm">GASO</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={segmentNone}
              class="w-4 h-4 accent-ink-900"
            />
            <span class="text-sm">Sin segmento</span>
          </label>
        </div>
      </div>

      <!-- Sale Status Filter -->
      <div>
        <h3 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-3">
          Estado de venta
        </h3>
        <div class="flex flex-wrap gap-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={saleStatusAll}
              onchange={() => handleSaleStatusChange("all")}
              class="w-4 h-4 accent-ink-900"
            />
            <span class="text-sm">Todos</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={saleStatusConfirmed}
              onchange={() => handleSaleStatusChange("confirmed")}
              class="w-4 h-4 accent-ink-900"
            />
            <span class="text-sm">Confirmados</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={saleStatusPending}
              onchange={() => handleSaleStatusChange("pending")}
              class="w-4 h-4 accent-ink-900"
            />
            <span class="text-sm">Pendientes</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              bind:checked={saleStatusRejected}
              onchange={() => handleSaleStatusChange("rejected")}
              class="w-4 h-4 accent-ink-900"
            />
            <span class="text-sm">Rechazados</span>
          </label>
        </div>
      </div>

      <!-- Generate Button -->
      <div class="pt-4 border-t border-cream-200">
        <div class="flex items-center justify-between">
          <p class="text-sm text-ink-400">
            {#if data.todayCount > 0}
              Contactos de hoy: <span class="font-bold text-ink-900">{data.todayCount}</span>
            {:else}
              Sin contactos registrados hoy
            {/if}
          </p>
          <Button onclick={generateReport} disabled={generating}>
            {generating ? "Generando..." : "Generar Excel"}
          </Button>
        </div>
      </div>
    </div>
  </div>
</div>
