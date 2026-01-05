<script lang="ts">
import { goto, invalidateAll } from "$app/navigation";
import type { OrderStatus } from "@totem/types";
import { fetchApi } from "$lib/utils/api";
import { toast } from "$lib/state/toast.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import Button from "$lib/components/ui/button.svelte";
import {
  formatPhone,
  formatPrice,
  formatDateTime,
} from "$lib/utils/formatters";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

let approvalNotes = $state("");
let processing = $state(false);

const statusLabels: Record<OrderStatus, string> = {
  pending: "Pendiente",
  supervisor_approved: "Aprobado por supervisor",
  supervisor_rejected: "Rechazado por supervisor",
  calidda_approved: "Aprobado por Calidda",
  calidda_rejected: "Rechazado por Calidda",
  delivered: "Entregado",
};

const statusColors: Record<OrderStatus, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-300",
  supervisor_approved: "bg-blue-100 text-blue-800 border-blue-300",
  supervisor_rejected: "bg-red-100 text-red-800 border-red-300",
  calidda_approved: "bg-green-100 text-green-800 border-green-300",
  calidda_rejected: "bg-red-100 text-red-800 border-red-300",
  delivered: "bg-gray-100 text-gray-800 border-gray-300",
};

async function updateStatus(
  newStatus: OrderStatus,
  noteType?: "supervisor" | "calidda",
) {
  if (!data.order) return;

  // Require notes for rejection
  if (newStatus.includes("rejected") && !approvalNotes.trim()) {
    toast.error("Debe ingresar una razón para el rechazo");
    return;
  }

  processing = true;
  try {
    await fetchApi(`/api/orders/${data.order.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: newStatus,
        notes: approvalNotes,
        noteType,
      }),
    });

    toast.success("Estado actualizado correctamente");
    approvalNotes = "";
    await invalidateAll();
  } catch (error) {
    console.error("Failed to update status:", error);
    toast.error("Error al actualizar el estado");
  } finally {
    processing = false;
  }
}

function goBack() {
  goto("/dashboard/orders");
}

function parseProducts(productsJson: string) {
  try {
    const parsed = JSON.parse(productsJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
</script>

<PageTitle title={data.order?.order_number || "Orden"} />

{#if !data.order}
  <div class="max-w-4xl mx-auto p-8 md:p-12 min-h-screen">
    <div class="text-center py-20">
      <p class="font-serif text-xl text-ink-400 italic">Orden no encontrada</p>
      <button onclick={goBack} class="mt-4 text-sm text-ink-600 hover:underline">
        Volver a órdenes
      </button>
    </div>
  </div>
{:else}
  {@const order = data.order}
  {@const products = parseProducts(order.products)}

  <div class="min-h-screen bg-cream-100">
    <!-- Header -->
    <div class="bg-white border-b border-ink-900/10 sticky top-16.25 z-10">
      <div class="max-w-7xl mx-auto px-8 py-6">
        <button onclick={goBack} class="text-xs text-ink-400 hover:text-ink-600 mb-2 flex items-center gap-1">
          <span>&larr;</span> Volver a órdenes
        </button>
        <div class="flex justify-between items-start">
          <div>
            <h1 class="font-serif text-3xl text-ink-900 mb-1">
              {order.order_number}
            </h1>
            <p class="text-ink-400 text-sm">Cliente: {order.client_name}</p>
          </div>
          <div class="px-4 py-2 border {statusColors[order.status as OrderStatus]}">
            <p class="text-xs font-bold uppercase tracking-widest">
              {statusLabels[order.status as OrderStatus]}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="max-w-7xl mx-auto px-8 py-8">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <!-- Main Column -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Client Info -->
          <div class="bg-white border border-cream-200 p-6">
            <h2 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
              Información del cliente
            </h2>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <p class="text-xs text-ink-400 mb-1">Nombre</p>
                <p class="text-sm font-medium">{order.client_name}</p>
              </div>
              <div>
                <p class="text-xs text-ink-400 mb-1">DNI</p>
                <p class="text-sm font-mono">{order.client_dni}</p>
              </div>
              <div>
                <p class="text-xs text-ink-400 mb-1">Teléfono</p>
                <p class="text-sm font-mono">{formatPhone(order.conversation_phone)}</p>
              </div>
              <div>
                <p class="text-xs text-ink-400 mb-1">Conversación</p>
                <a
                  href="/dashboard/conversations/{order.conversation_phone}"
                  class="text-sm text-ink-900 hover:underline font-medium"
                >
                  Ver conversación →
                </a>
              </div>
            </div>
          </div>

          <!-- Products -->
          <div class="bg-white border border-cream-200 p-6">
            <h2 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
              Productos
            </h2>
            {#if products.length > 0}
              <div class="space-y-3">
                {#each products as product}
                  <div class="border-b border-cream-200 pb-3 last:border-b-0">
                    <p class="text-sm font-medium">{product.name || "Producto"}</p>
                    {#if product.price}
                      <p class="text-xs text-ink-500 font-mono mt-1">S/ {formatPrice(product.price)}</p>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-sm text-ink-400 italic">No hay productos especificados</p>
            {/if}
            <div class="mt-4 pt-4 border-t border-cream-200">
              <div class="flex justify-between items-center">
                <span class="text-xs font-bold uppercase tracking-widest text-ink-400">Total</span>
                <span class="text-lg font-bold font-mono">S/ {formatPrice(order.total_amount)}</span>
              </div>
            </div>
          </div>

          <!-- Delivery Info -->
          <div class="bg-white border border-cream-200 p-6">
            <h2 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
              Información de entrega
            </h2>
            <div class="space-y-3">
              <div>
                <p class="text-xs text-ink-400 mb-1">Dirección</p>
                <p class="text-sm">{order.delivery_address || "—"}</p>
              </div>
              {#if order.delivery_reference}
                <div>
                  <p class="text-xs text-ink-400 mb-1">Referencia</p>
                  <p class="text-sm">{order.delivery_reference}</p>
                </div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Sidebar -->
        <div class="space-y-6">
          <!-- Approval Management -->
          {#if order.status !== "delivered" && !order.status.includes("rejected")}
            <div class="bg-white border border-cream-200 p-6">
              <h2 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
                Gestión de Aprobación
              </h2>
              
              <div class="space-y-4">
                {#if order.status === "pending" || order.status === "supervisor_approved"}
                  <div>
                    <label for="approval-notes" class="block text-xs text-ink-400 mb-1">
                      Notas de aprobación/rechazo
                    </label>
                    <textarea
                      id="approval-notes"
                      bind:value={approvalNotes}
                      rows="3"
                      class="w-full px-3 py-2 border border-ink-200 text-sm focus:outline-none focus:border-ink-900 resize-none"
                      placeholder="Ingrese observaciones..."
                    ></textarea>
                  </div>
                {/if}

                <div class="grid grid-cols-2 gap-3">
                  {#if order.status === "pending"}
                    <Button 
                      onclick={() => updateStatus("supervisor_approved", "supervisor")}
                      disabled={processing}
                      variant="primary"
                      class="w-full"
                    >
                      Aprobar (Sup)
                    </Button>
                    <Button 
                      onclick={() => updateStatus("supervisor_rejected", "supervisor")}
                      disabled={processing}
                      variant="secondary"
                      class="w-full bg-red-50! text-red-700! hover:bg-red-100! border-red-200"
                    >
                      Rechazar
                    </Button>
                  {:else if order.status === "supervisor_approved"}
                    <Button 
                      onclick={() => updateStatus("calidda_approved", "calidda")}
                      disabled={processing}
                      variant="primary"
                      class="w-full"
                    >
                      Aprobar (Calidda)
                    </Button>
                    <Button 
                      onclick={() => updateStatus("calidda_rejected", "calidda")}
                      disabled={processing}
                      variant="secondary"
                      class="w-full bg-red-50! text-red-700! hover:bg-red-100! border-red-200"
                    >
                      Rechazar
                    </Button>
                  {:else if order.status === "calidda_approved"}
                    <div class="col-span-2">
                      <Button 
                        onclick={() => updateStatus("delivered")}
                        disabled={processing}
                        variant="primary"
                        class="w-full"
                      >
                        Marcar como Entregado
                      </Button>
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {/if}

          <!-- Timeline -->
          <div class="bg-white border border-cream-200 p-6">
            <h2 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
              Timeline
            </h2>
            <div class="space-y-3 text-sm">
              <div>
                <p class="text-xs text-ink-400">Creada</p>
                <p class="font-mono text-xs mt-1">{formatDateTime(order.created_at)}</p>
              </div>
              <div>
                <p class="text-xs text-ink-400">Última actualización</p>
                <p class="font-mono text-xs mt-1">{formatDateTime(order.updated_at)}</p>
              </div>
            </div>
          </div>

          <!-- Notes -->
          {#if order.supervisor_notes}
            <div class="bg-white border border-cream-200 p-6">
              <h2 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
                Notas del supervisor
              </h2>
              <p class="text-sm text-ink-600">{order.supervisor_notes}</p>
            </div>
          {/if}

          {#if order.calidda_notes}
            <div class="bg-white border border-cream-200 p-6">
              <h2 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
                Notas de Calidda
              </h2>
              <p class="text-sm text-ink-600">{order.calidda_notes}</p>
            </div>
          {/if}

          <!-- Assigned Agent -->
          {#if order.assigned_agent}
            <div class="bg-white border border-cream-200 p-6">
              <h2 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
                Agente asignado
              </h2>
              <p class="text-sm font-mono">{order.assigned_agent}</p>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
