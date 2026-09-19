<script lang="ts">
import PageHeader from "$lib/components/shared/page-header.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import Button from "$lib/components/ui/button.svelte";
import { limaDateString } from "$lib/utils/formatters";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

let startDate = $state(limaDateString());
let endDate = $state(limaDateString());
let segmentFnb = $state(true);
let segmentGaso = $state(true);
let segmentNone = $state(true);
let saleStatusAll = $state(true);
let saleStatusConfirmed = $state(false);
let saleStatusPending = $state(false);
let saleStatusRejected = $state(false);
let generating = $state(false);

let orderStartDate = $state("");
let orderEndDate = $state("");
let orderStatus = $state("");
let generatingOrders = $state(false);

const DAY_MS = 24 * 60 * 60 * 1000;

function setQuickDate(days: number) {
  const now = Date.now();
  startDate = limaDateString(now - days * DAY_MS);
  endDate = limaDateString(now);
}

function setToday() {
  const today = limaDateString();
  startDate = today;
  endDate = today;
}

function setYesterday() {
  const yesterday = limaDateString(Date.now() - DAY_MS);
  startDate = yesterday;
  endDate = yesterday;
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

async function generateOrderReport() {
  generatingOrders = true;

  const params = new URLSearchParams();
  if (orderStartDate) params.append("startDate", orderStartDate);
  if (orderEndDate) params.append("endDate", orderEndDate);
  if (orderStatus) params.append("status", orderStatus);

  try {
    const res = await fetch(`/api/reports/orders?${params}`);
    if (!res.ok) throw new Error("Failed to generate order report");

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateRange = orderStartDate
      ? `${orderStartDate}-a-${orderEndDate || "hoy"}`
      : "todas";
    a.download = `reporte-ordenes-${dateRange}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Failed to generate order report:", error);
  } finally {
    generatingOrders = false;
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

  <!-- Order Report -->
  <div class="bg-white border border-cream-200 p-8 mt-8">
    <h2 class="font-serif text-2xl mb-2">Reporte de órdenes</h2>
    <p class="text-ink-400 text-sm mb-8">
      Exporta todas las órdenes registradas con detalles de estado, montos y aprobaciones.
    </p>

    <div class="space-y-6">
      <!-- Date Range -->
      <div>
        <h3 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-3">
          Período (opcional)
        </h3>
        <div class="flex gap-4 items-center">
          <div>
            <label for="order-start-date" class="block text-xs text-ink-400 mb-1">Desde</label>
            <input
              id="order-start-date"
              type="date"
              bind:value={orderStartDate}
              class="px-4 py-2 border border-ink-200 font-mono text-sm focus:outline-none focus:border-ink-900"
            />
          </div>
          <span class="text-ink-300 mt-5">—</span>
          <div>
            <label for="order-end-date" class="block text-xs text-ink-400 mb-1">Hasta</label>
            <input
              id="order-end-date"
              type="date"
              bind:value={orderEndDate}
              class="px-4 py-2 border border-ink-200 font-mono text-sm focus:outline-none focus:border-ink-900"
            />
          </div>
        </div>
      </div>

      <!-- Status Filter -->
      <div>
        <h3 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-3">
          Estado (opcional)
        </h3>
        <select
          bind:value={orderStatus}
          class="px-4 py-2 border border-ink-200 text-sm focus:outline-none focus:border-ink-900 min-w-50"
        >
          <option value="">Todos los estados</option>
          <option value="pending">Pendiente</option>
          <option value="supervisor_approved">Aprobado supervisor</option>
          <option value="supervisor_rejected">Rechazado supervisor</option>
          <option value="calidda_approved">Aprobado Calidda</option>
          <option value="calidda_rejected">Rechazado Calidda</option>
          <option value="delivered">Entregado</option>
        </select>
      </div>

      <!-- Generate Button -->
      <div class="pt-4 border-t border-cream-200">
        <div class="flex items-center justify-end">
          <Button onclick={generateOrderReport} disabled={generatingOrders}>
            {generatingOrders ? "Generando..." : "Generar Excel"}
          </Button>
        </div>
      </div>
    </div>
  </div>
</div>
