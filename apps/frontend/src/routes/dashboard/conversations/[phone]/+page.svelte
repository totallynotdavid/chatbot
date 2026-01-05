<script lang="ts">
import { goto } from "$app/navigation";
import type {
  Conversation,
  Message as MessageType,
  SaleStatus,
} from "@totem/types";
import { fetchApi } from "$lib/utils/api";
import {
  formatPhone,
  formatPrice,
  formatDateTime,
} from "$lib/utils/formatters";
import PageTitle from "$lib/components/shared/page-title.svelte";
import Button from "$lib/components/ui/button.svelte";
import MessageThread from "$lib/components/conversations/message-thread.svelte";
import MessageInput from "$lib/components/conversations/message-input.svelte";
import type { PageData } from "./$types";

interface Props {
  data: PageData;
}
let { data }: Props = $props();

// Core state - initialized from data, can be refreshed via API
let conversation = $state<Conversation | null>(null);
let messages = $state<MessageType[]>([]);
let messageText = $state("");
let saving = $state(false);

// Agent editable fields
let agentNotes = $state("");
let saleStatus = $state<SaleStatus>("pending");
let deliveryAddress = $state("");
let deliveryReference = $state("");

// Initialize state from server data
$effect(() => {
  conversation = data.conversation;
  messages = data.messages || [];
  // Reset form fields when conversation changes
  agentNotes = data.conversation?.agent_notes || "";
  saleStatus = data.conversation?.sale_status || "pending";
  deliveryAddress = data.conversation?.delivery_address || "";
  deliveryReference = data.conversation?.delivery_reference || "";
});

const isHumanTakeover = $derived(conversation?.status === "human_takeover");

const saleStatusOptions: { value: SaleStatus; label: string }[] = [
  { value: "pending", label: "Pendiente" },
  { value: "confirmed", label: "Confirmado" },
  { value: "rejected", label: "Rechazado" },
  { value: "no_answer", label: "Sin respuesta" },
];

async function handleTakeover() {
  if (!conversation) return;
  await fetchApi(`/api/conversations/${conversation.phone_number}/takeover`, {
    method: "POST",
  });
  await refreshConversation();
}

async function handleRelease() {
  if (!conversation) return;
  await fetchApi(`/api/conversations/${conversation.phone_number}/release`, {
    method: "POST",
  });
  await refreshConversation();
}

async function handleSendMessage() {
  if (!(conversation && messageText.trim())) return;

  await fetchApi(`/api/conversations/${conversation.phone_number}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: messageText }),
  });

  messageText = "";
  await refreshConversation();
}

async function refreshConversation() {
  if (!conversation) return;
  const detail = await fetchApi<any>(
    `/api/conversations/${conversation.phone_number}`,
  );
  conversation = detail.conversation;
  messages = detail.messages;
}

async function saveAgentData() {
  if (!conversation) return;
  saving = true;

  try {
    await fetchApi(
      `/api/conversations/${conversation.phone_number}/agent-data`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_notes: agentNotes,
          sale_status: saleStatus,
          delivery_address: deliveryAddress,
          delivery_reference: deliveryReference,
        }),
      },
    );
    await refreshConversation();
  } catch (error) {
    console.error("Failed to save:", error);
  } finally {
    saving = false;
  }
}

function goBack() {
  goto("/dashboard/conversations");
}
</script>

<PageTitle title={conversation?.client_name || formatPhone(conversation?.phone_number || "")} />

{#if !conversation}
  <div class="max-w-4xl mx-auto p-8 md:p-12 min-h-screen">
    <div class="text-center py-20">
      <p class="font-serif text-xl text-ink-400 italic">Conversación no encontrada</p>
      <button onclick={goBack} class="mt-4 text-sm text-ink-600 hover:underline">
        Volver a conversaciones
      </button>
    </div>
  </div>
{:else}
  <div class="min-h-screen bg-cream-100">
    <!-- Header -->
    <div class="bg-white border-b border-ink-900/10 sticky top-[65px] z-10">
      <div class="max-w-7xl mx-auto px-8 py-6">
        <div class="flex justify-between items-start mb-6">
          <div>
            <button onclick={goBack} class="text-xs text-ink-400 hover:text-ink-600 mb-2 flex items-center gap-1">
              <span>&larr;</span> Volver a conversaciones
            </button>
            <h1 class="font-serif text-3xl text-ink-900">
              {#if conversation.client_name}
                {conversation.client_name}
              {:else}
                {formatPhone(conversation.phone_number)}
              {/if}
            </h1>
            {#if conversation.client_name}
              <p class="text-ink-400 font-mono text-sm mt-1">{formatPhone(conversation.phone_number)}</p>
            {/if}
          </div>

          <div class="flex items-center gap-3">
            {#if isHumanTakeover}
              <Button variant="secondary" onclick={handleRelease}>
                Devolver al bot
              </Button>
            {:else}
              <Button variant="secondary" onclick={handleTakeover}>
                Intervenir
              </Button>
            {/if}
          </div>
        </div>

        <!-- Context Data Bar -->
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-[10px] font-mono uppercase tracking-wider text-ink-500 border-t border-ink-900/5 pt-4">
          <div class="flex gap-2">
            <span class="text-ink-300">DNI:</span>
            <span class="text-ink-900 font-bold">{conversation.dni || "—"}</span>
          </div>
          <div class="w-px h-3 bg-ink-200"></div>
          <div class="flex gap-2">
            <span class="text-ink-300">Segmento:</span>
            <span class="text-ink-900 font-bold">{conversation.segment?.toUpperCase() || "—"}</span>
          </div>
          <div class="w-px h-3 bg-ink-200"></div>
          <div class="flex gap-2">
            <span class="text-ink-300">Crédito:</span>
            <span class="text-ink-900 font-bold">
              {conversation.credit_line ? `S/ ${formatPrice(conversation.credit_line)}` : "—"}
            </span>
          </div>
          <div class="w-px h-3 bg-ink-200"></div>
          <div class="flex gap-2">
            <span class="text-ink-300">NSE:</span>
            <span class="text-ink-900 font-bold">{conversation.nse || "—"}</span>
          </div>
          <div class="w-px h-3 bg-ink-200"></div>
          <div class="flex gap-2">
            <span class="text-ink-300">Estado:</span>
            <span class="text-ink-900 font-bold">{conversation.current_state}</span>
          </div>
          {#if isHumanTakeover}
            <div class="w-px h-3 bg-ink-200"></div>
            <div class="flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse"></span>
              <span class="text-red-600 font-bold">Intervención activa</span>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="max-w-7xl mx-auto px-8 py-8">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <!-- Left Column: Messages -->
        <div class="lg:col-span-2 bg-white border border-cream-200 flex flex-col" style="height: 600px;">
          <div class="flex-1 overflow-hidden">
            <MessageThread {messages} />
          </div>
          {#if isHumanTakeover}
            <div class="border-t border-cream-200">
              <MessageInput
                bind:value={messageText}
                onSend={handleSendMessage}
              />
            </div>
          {/if}
        </div>

        <!-- Right Column: Agent Actions -->
        <div class="space-y-6">
          <!-- Sale Status -->
          <div class="bg-white border border-cream-200 p-6">
            <h3 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
              Estado de venta
            </h3>
            <div class="space-y-2">
              {#each saleStatusOptions as option}
                <label class="flex items-center gap-3 cursor-pointer p-2 hover:bg-cream-50 transition-colors">
                  <input
                    type="radio"
                    name="saleStatus"
                    value={option.value}
                    bind:group={saleStatus}
                    class="w-4 h-4 accent-ink-900"
                  />
                  <span class="text-sm">{option.label}</span>
                </label>
              {/each}
            </div>
          </div>

          <!-- Delivery Info (only show if confirmed) -->
          {#if saleStatus === "confirmed"}
            <div class="bg-white border border-cream-200 p-6">
              <h3 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
                Datos de entrega
              </h3>
              <div class="space-y-4">
                <div>
                  <label for="delivery-address" class="block text-xs text-ink-400 mb-1">Dirección</label>
                  <textarea
                    id="delivery-address"
                    bind:value={deliveryAddress}
                    rows="2"
                    class="w-full px-3 py-2 border border-ink-200 text-sm focus:outline-none focus:border-ink-900 resize-none"
                    placeholder="Av. Lima 123, San Isidro"
                  ></textarea>
                </div>
                <div>
                  <label for="delivery-reference" class="block text-xs text-ink-400 mb-1">Referencia</label>
                  <input
                    id="delivery-reference"
                    type="text"
                    bind:value={deliveryReference}
                    class="w-full px-3 py-2 border border-ink-200 text-sm focus:outline-none focus:border-ink-900"
                    placeholder="Frente al parque"
                  />
                </div>
              </div>
            </div>
          {/if}

          <!-- Agent Notes -->
          <div class="bg-white border border-cream-200 p-6">
            <h3 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
              Observaciones
            </h3>
            <textarea
              bind:value={agentNotes}
              rows="4"
              class="w-full px-3 py-2 border border-ink-200 text-sm focus:outline-none focus:border-ink-900 resize-none"
              placeholder="Notas sobre la llamada, productos de interés, etc."
            ></textarea>
          </div>

          <!-- Products Interested -->
          {#if conversation.products_interested && conversation.products_interested !== "[]"}
            <div class="bg-white border border-cream-200 p-6">
              <h3 class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
                Productos de interés
              </h3>
              <p class="text-sm text-ink-600 font-mono">
                {conversation.products_interested}
              </p>
            </div>
          {/if}

          <!-- Save Button -->
          <Button onclick={saveAgentData} disabled={saving} class="w-full">
            {saving ? "Guardando..." : "Guardar cambios"}
          </Button>

          <!-- Metadata -->
          <div class="text-xs text-ink-300 space-y-1">
            <p>Última actividad: {formatDateTime(conversation.last_activity_at)}</p>
            {#if conversation.handover_reason}
              <p class="text-red-600">Razón escalamiento: {conversation.handover_reason}</p>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
