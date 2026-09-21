<script lang="ts">
import { goto } from "$app/navigation";
import type { OrderStatus } from "@vendeya/types";
import PageHeader from "$lib/components/shared/page-header.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import {
  formatPhone,
  formatPrice,
  formatDateTime,
} from "$lib/utils/formatters";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

// Filter state
let statusFilter = $state<string>("");
let startDate = $state("");
let endDate = $state("");

const statusOptions: { value: OrderStatus | ""; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "pending", label: "Pendiente" },
  { value: "supervisor_approved", label: "Aprobado supervisor" },
  { value: "supervisor_rejected", label: "Rechazado supervisor" },
  { value: "calidda_approved", label: "Aprobado Calidda" },
  { value: "calidda_rejected", label: "Rechazado Calidda" },
  { value: "delivered", label: "Entregado" },
];

const statusColors: Record<OrderStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  supervisor_approved: "bg-blue-100 text-blue-800",
  supervisor_rejected: "bg-red-100 text-red-800",
  calidda_approved: "bg-green-100 text-green-800",
  calidda_rejected: "bg-red-100 text-red-800",
  delivered: "bg-gray-100 text-gray-800",
};

function applyFilters() {
  const params = new URLSearchParams();
  if (statusFilter) params.append("status", statusFilter);
  if (startDate) params.append("startDate", startDate);
  if (endDate) params.append("endDate", endDate);

  const queryString = params.toString();
  goto(`/dashboard/orders${queryString ? `?${queryString}` : ""}`);
}

function clearFilters() {
  statusFilter = "";
  startDate = "";
  endDate = "";
  goto("/dashboard/orders");
}
</script>

<PageTitle title="Órdenes" />

<div class="max-w-7xl mx-auto p-8 md:p-12 min-h-screen">
  <PageHeader title="Órdenes" subtitle="Gestión de pedidos y entregas" />

  <!-- Metrics Summary -->
  {#if data.metrics}
    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
      <div class="bg-white border border-cream-200 p-6">
        <p class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-2">
          Pendientes
        </p>
        <p class="text-3xl font-bold font-mono text-yellow-700">{data.metrics.pendingCount}</p>
        <p class="text-xs text-ink-400 mt-1">Requieren aprobación</p>
      </div>
      <div class="bg-white border border-cream-200 p-6">
        <p class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-2">
          Entregados
        </p>
        <p class="text-3xl font-bold font-mono text-green-700">{data.metrics.deliveredCount}</p>
        <p class="text-xs text-ink-400 mt-1">{data.metrics.approvalRate.toFixed(1)}% tasa de aprobación</p>
      </div>
      <div class="bg-white border border-cream-200 p-6">
        <p class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-2">
          Ingresos totales
        </p>
        <p class="text-2xl font-bold font-mono text-ink-900">S/ {formatPrice(data.metrics.totalRevenue)}</p>
        <p class="text-xs text-ink-400 mt-1">Ticket prom: S/ {formatPrice(data.metrics.avgOrderValue)}</p>
      </div>
      <div class="bg-white border border-cream-200 p-6">
        <p class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-2">
          Este mes
        </p>
        <p class="text-2xl font-bold font-mono text-blue-700">S/ {formatPrice(data.metrics.revenueThisMonth)}</p>
        <p class="text-xs text-ink-400 mt-1">{data.metrics.rejectionRate.toFixed(1)}% rechazados</p>
      </div>
    </div>
  {/if}

  <!-- Filters -->
  <div class="bg-white border border-cream-200 p-6 mb-6">
    <h3 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
      Filtros
    </h3>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div>
        <label for="status-filter" class="block text-xs text-ink-400 mb-1">Estado</label>
        <select
          id="status-filter"
          bind:value={statusFilter}
          class="w-full px-3 py-2 border border-ink-200 text-sm focus:outline-none focus:border-ink-900"
        >
          {#each statusOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>
      <div>
        <label for="start-date-filter" class="block text-xs text-ink-400 mb-1">Desde</label>
        <input
          id="start-date-filter"
          type="date"
          bind:value={startDate}
          class="w-full px-3 py-2 border border-ink-200 text-sm focus:outline-none focus:border-ink-900"
        />
      </div>
      <div>
        <label for="end-date-filter" class="block text-xs text-ink-400 mb-1">Hasta</label>
        <input
          id="end-date-filter"
          type="date"
          bind:value={endDate}
          class="w-full px-3 py-2 border border-ink-200 text-sm focus:outline-none focus:border-ink-900"
        />
      </div>
      <div class="flex items-end gap-2">
        <button
          onclick={applyFilters}
          class="flex-1 px-4 py-2 bg-ink-900 text-white text-xs font-bold uppercase tracking-widest hover:bg-ink-600 transition-colors"
        >
          Aplicar
        </button>
        <button
          onclick={clearFilters}
          class="px-4 py-2 border border-ink-200 text-xs font-bold uppercase tracking-widest hover:bg-cream-50 transition-colors"
        >
          Limpiar
        </button>
      </div>
    </div>
  </div>

  <!-- Orders List -->
  <div class="bg-white border border-cream-200">
    {#if data.orders.length === 0}
      <div class="p-12 text-center">
        <p class="font-serif text-xl text-ink-400 italic">No hay órdenes registradas</p>
      </div>
    {:else}
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead class="border-b border-ink-900/10">
            <tr>
              <th class="text-left px-6 py-4 text-xs font-bold uppercase tracking-widest text-ink-400">
                Orden
              </th>
              <th class="text-left px-6 py-4 text-xs font-bold uppercase tracking-widest text-ink-400">
                Cliente
              </th>
              <th class="text-left px-6 py-4 text-xs font-bold uppercase tracking-widest text-ink-400">
                Monto
              </th>
              <th class="text-left px-6 py-4 text-xs font-bold uppercase tracking-widest text-ink-400">
                Estado
              </th>
              <th class="text-left px-6 py-4 text-xs font-bold uppercase tracking-widest text-ink-400">
                Fecha
              </th>
              <th class="text-left px-6 py-4 text-xs font-bold uppercase tracking-widest text-ink-400">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {#each data.orders as order}
              <tr class="border-b border-ink-900/5 hover:bg-cream-50 transition-colors">
                <td class="px-6 py-4">
                  <span class="font-mono text-sm font-bold">{order.order_number}</span>
                </td>
                <td class="px-6 py-4">
                  <div>
                    <p class="text-sm font-medium">{order.client_name}</p>
                    <p class="text-xs text-ink-400">{formatPhone(order.conversation_phone)}</p>
                  </div>
                </td>
                <td class="px-6 py-4">
                  <span class="font-mono text-sm">S/ {formatPrice(order.total_amount)}</span>
                </td>
                <td class="px-6 py-4">
                  <span class="px-2 py-1 text-xs font-medium rounded {statusColors[order.status as OrderStatus]}">
                    {statusOptions.find(o => o.value === order.status)?.label}
                  </span>
                </td>
                <td class="px-6 py-4">
                  <span class="text-xs text-ink-500">{formatDateTime(order.created_at)}</span>
                </td>
                <td class="px-6 py-4">
                  <a
                    href="/dashboard/orders/{order.id}"
                    class="text-xs text-ink-900 hover:underline font-bold uppercase tracking-widest"
                  >
                    Ver →
                  </a>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>
