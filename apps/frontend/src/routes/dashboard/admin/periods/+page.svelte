<script lang="ts">
import { onMount } from "svelte";
import type { CatalogPeriod } from "@vendeya/types";
import { fetchApi } from "$lib/utils/api";
import { toast } from "$lib/state/toast.svelte";
import Button from "$lib/components/ui/button.svelte";
import Badge from "$lib/components/ui/badge.svelte";
import Modal from "$lib/components/ui/modal.svelte";
import Input from "$lib/components/ui/input.svelte";
import Label from "$lib/components/ui/label.svelte";
import SectionShell from "$lib/components/ui/section-shell.svelte";

let periods = $state<CatalogPeriod[]>([]);
let isLoading = $state(true);

// Modals State
let isCreateModalOpen = $state(false);
let isPublishModalOpen = $state(false);
let isArchiveModalOpen = $state(false);
let isDeleteModalOpen = $state(false);

// Action Context
let selectedPeriod = $state<CatalogPeriod | null>(null);
let activePeriod = $derived(periods.find((p) => p.status === "active"));

// Form State
let newPeriodName = $state("");
let newPeriodMonth = $state("");

async function loadPeriods() {
  isLoading = true;
  try {
    periods = await fetchApi<CatalogPeriod[]>("/api/periods");
  } catch (error) {
    console.error("Failed to load periods:", error);
    toast.error("Error al cargar los periodos");
  } finally {
    isLoading = false;
  }
}

async function handleCreate() {
  if (!newPeriodName || !newPeriodMonth) {
    toast.error("Todos los campos son obligatorios");
    return;
  }

  try {
    const newPeriod = await fetchApi<CatalogPeriod>("/api/periods", {
      method: "POST",
      body: JSON.stringify({
        name: newPeriodName,
        year_month: newPeriodMonth,
      }),
    });

    periods = [newPeriod, ...periods].sort((a, b) => 
      b.year_month.localeCompare(a.year_month)
    );
    toast.success("Periodo creado exitosamente");
    closeCreateModal();
  } catch (error) {
    console.error("Failed to create period:", error);
    toast.error("Error al crear el periodo");
  }
}

async function handlePublish() {
  if (!selectedPeriod) return;

  try {
    const updated = await fetchApi<CatalogPeriod>(`/api/periods/${selectedPeriod.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
    });

    // Update local state: 
    // 1. Archive previous active period if exists
    // 2. Set new period to active
    periods = periods.map(p => {
        if (p.id === updated.id) return updated;
        if (p.status === "active") return { ...p, status: "archived" as const };
        return p;
    });

    toast.success("Periodo publicado exitosamente");
    closePublishModal();
  } catch (error) {
    console.error("Failed to publish period:", error);
    toast.error("Error al publicar el periodo");
  }
}

async function handleArchive() {
  if (!selectedPeriod) return;

  try {
    const updated = await fetchApi<CatalogPeriod>(`/api/periods/${selectedPeriod.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });

    periods = periods.map(p => p.id === updated.id ? updated : p);
    toast.success("Periodo archivado exitosamente");
    closeArchiveModal();
  } catch (error) {
    console.error("Failed to archive period:", error);
    toast.error("Error al archivar el periodo");
  }
}

async function handleDelete() {
  if (!selectedPeriod) return;

  try {
    await fetchApi(`/api/periods/${selectedPeriod.id}`, {
      method: "DELETE",
    });

    periods = periods.filter(p => p.id !== selectedPeriod?.id);
    toast.success("Periodo eliminado exitosamente");
    closeDeleteModal();
  } catch (error) {
    console.error("Failed to delete period:", error);
    // Backend validation message might be useful here if we parse it
    // Assuming fetchApi throws usually, but we might want to alert specific message regarding products
    toast.error("Error al eliminar. Verifique que no tenga productos.");
  }
}

// Modal Helpers
function openCreateModal() {
  newPeriodName = "";
  newPeriodMonth = new Date().toISOString().slice(0, 7); // Default to current YYYY-MM
  isCreateModalOpen = true;
}

function closeCreateModal() {
  isCreateModalOpen = false;
}

function openPublishModal(period: CatalogPeriod) {
  selectedPeriod = period;
  isPublishModalOpen = true;
}

function closePublishModal() {
  selectedPeriod = null;
  isPublishModalOpen = false;
}

function openArchiveModal(period: CatalogPeriod) {
  selectedPeriod = period;
  isArchiveModalOpen = true;
}

function closeArchiveModal() {
  selectedPeriod = null;
  isArchiveModalOpen = false;
}

function openDeleteModal(period: CatalogPeriod) {
  selectedPeriod = period;
  isDeleteModalOpen = true;
}

function closeDeleteModal() {
  selectedPeriod = null;
  isDeleteModalOpen = false;
}

function getStatusVariant(status: string): "default" | "success" | "warning" {
    switch (status) {
        case "active": return "success";
        case "draft": return "warning";
        case "archived": return "default";
        default: return "default";
    }
}

function getStatusLabel(status: string): string {
    switch (status) {
        case "active": return "ACTIVO";
        case "draft": return "BORRADOR";
        case "archived": return "ARCHIVADO";
        default: return status;
    }
}

onMount(() => {
  loadPeriods();
});
</script>

<div class="space-y-6">
  <SectionShell 
      title="Gestión de periodos" 
      description="Administra los ciclos de venta y publicación de catálogos."
      action={headerAction}
  >
    <div class="overflow-x-auto">
      <table class="w-full text-sm text-left">
          <thead class="bg-cream-50 font-mono text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
              <tr>
                  <th class="px-6 py-4 font-bold select-none whitespace-nowrap">Nombre</th>
                  <th class="px-6 py-4 font-bold select-none whitespace-nowrap">Código (Mes)</th>
                  <th class="px-6 py-4 font-bold select-none whitespace-nowrap">Estado</th>
                  <th class="px-6 py-4 font-bold select-none whitespace-nowrap text-right">Acciones</th>
              </tr>
          </thead>
          <tbody class="divide-y divide-ink-50 bg-white">
              {#if isLoading}
                  {#each Array(3) as _}
                      <tr class="animate-pulse">
                        <td class="px-6 py-4"><div class="h-4 bg-cream-100 rounded w-2/3"></div></td>
                        <td class="px-6 py-4"><div class="h-4 bg-cream-100 rounded w-1/3"></div></td>
                        <td class="px-6 py-4"><div class="h-4 bg-cream-100 rounded w-16"></div></td>
                        <td class="px-6 py-4"><div class="h-4 bg-cream-100 rounded w-20 ml-auto"></div></td>
                      </tr>
                  {/each}
              {:else if periods.length === 0}
                  <tr>
                      <td colspan="4" class="px-6 py-12 text-center text-ink-400 italic">
                          No hay periodos registrados. Crea uno nuevo para comenzar.
                      </td>
                  </tr>
              {:else}
                  {#each periods as period}
                      <tr class="group transition-colors hover:bg-cream-50/50">
                          <td class="px-6 py-4">
                              <div class="font-serif font-medium text-ink-900">
                                {period.name}
                                {#if period.status === 'active'}
                                  <span class="ml-2 text-[10px] text-green-600 font-bold tracking-widest uppercase inline-block bg-green-50 px-1.5 py-0.5 rounded">Bot vendiendo</span>
                                {/if}
                              </div>
                          </td>
                          <td class="px-6 py-4 font-mono text-xs text-ink-500">
                              {period.year_month}
                          </td>
                          <td class="px-6 py-4">
                              <Badge variant={getStatusVariant(period.status)}>
                                {getStatusLabel(period.status)}
                              </Badge>
                          </td>
                          <td class="px-6 py-4 text-right">
                            <div class="flex justify-end gap-2">
                              {#if period.status === 'draft'}
                                <Button variant="ghost" size="sm" onclick={() => openDeleteModal(period)} class="text-red-600 hover:bg-red-50 hover:text-red-700 h-8 px-3">
                                  Eliminar
                                </Button>
                                <Button variant="primary" size="sm" onclick={() => openPublishModal(period)} class="h-8 px-3 py-0">
                                  Publicar
                                </Button>
                              {:else if period.status === 'active'}
                                <Button variant="secondary" size="sm" onclick={() => openArchiveModal(period)} class="h-8 px-3 py-0">
                                  Archivar
                                </Button>
                              {:else}
                                 <span class="text-xs text-ink-400 italic py-1 px-3">Solo lectura</span>
                              {/if}
                            </div>
                          </td>
                      </tr>
                  {/each}
              {/if}
          </tbody>
      </table>
    </div>
  </SectionShell>
</div>

{#snippet headerAction()}
  <Button onclick={openCreateModal}>
    + Nuevo Periodo
  </Button>
{/snippet}

<!-- CREATE MODAL -->
<Modal 
  bind:open={isCreateModalOpen} 
  onClose={closeCreateModal}
  title="Crear nuevo periodo"
  subtitle="Configuración inicial"
>
  <div class="space-y-6">
    <div class="space-y-2">
      <Label for="name">Nombre de la campaña</Label>
      <Input id="name" bind:value={newPeriodName} placeholder="Ej. Campaña Escolar 2026" />
    </div>
    
    <div class="space-y-2">
      <Label for="month">Mes de facturación (YYYY-MM)</Label>
      <!-- Using type="month" provides native picker but value format matches YYYY-MM -->
      <Input id="month" type="text" bind:value={newPeriodMonth} placeholder="2026-03" />
      <p class="text-[10px] text-ink-400">
        Debe tener el formato AAAA-MM (Ej. 2026-03)
      </p>
    </div>
  </div>

  {#snippet footer()}
      <Button variant="secondary" onclick={closeCreateModal}>Cancelar</Button>
      <Button onclick={handleCreate}>Crear Periodo</Button>
  {/snippet}
</Modal>

<!-- PUBLISH MODAL -->
<Modal 
  bind:open={isPublishModalOpen} 
  onClose={closePublishModal}
  title="Publicar periodo"
  subtitle="Confirmación de activación"
>
  <div class="space-y-4">
    <div class="p-4 bg-amber-50 border border-amber-200 rounded-md text-amber-900 text-sm">
      <p class="font-bold mb-2">Atención</p>
      <p>Estás a punto de publicar el periodo <strong>{selectedPeriod?.name}</strong>.</p>
    </div>

    <p class="text-ink-600">
      Al realizar esta acción:
    </p>
    <ul class="list-disc pl-5 space-y-2 text-ink-600 text-sm">
      <li>El periodo actual ({activePeriod?.name || 'Ninguno'}) será <strong>archivado automáticamente</strong>.</li>
      <li>El bot de ventas comenzará a ofrecer <strong>inmediatamente</strong> los productos de este nuevo catálogo.</li>
      <li>Verifica que hayas cargado todos los productos y paquetes antes de continuar.</li>
    </ul>
  </div>

  {#snippet footer()}
      <Button variant="secondary" onclick={closePublishModal}>Cancelar</Button>
      <Button onclick={handlePublish}>Sí, Publicar Catálogo</Button>
  {/snippet}
</Modal>

<!-- ARCHIVE MODAL -->
<Modal 
  bind:open={isArchiveModalOpen} 
  onClose={closeArchiveModal}
  title="Archivar Periodo"
  subtitle="Desactivar catálogo actual"
>
  <div class="space-y-4">
    <p class="text-ink-600">
      ¿Estás seguro de que deseas archivar el periodo <strong>{selectedPeriod?.name}</strong>?
    </p>
    <p class="text-ink-500 text-sm">
      El bot dejará de vender productos inmediatamente. No habrá ningún catálogo activo hasta que publiques uno nuevo.
    </p>
  </div>

  {#snippet footer()}
      <Button variant="secondary" onclick={closeArchiveModal}>Cancelar</Button>
      <Button onclick={handleArchive}>Archivar</Button>
  {/snippet}
</Modal>

<!-- DELETE MODAL -->
<Modal 
  bind:open={isDeleteModalOpen} 
  onClose={closeDeleteModal}
  title="Eliminar Borrador"
  subtitle="Acción irreversible"
>
  <div class="space-y-4">
    <div class="p-4 bg-red-50 border border-red-200 rounded-md text-red-900 text-sm">
      <p class="font-bold mb-1">¿Estás completamente seguro?</p>
      <p>Esta acción eliminará permanentemente el borrador <strong>{selectedPeriod?.name}</strong>.</p>
    </div>
    
    <p class="text-ink-500 text-sm">
      Nota: Solo se pueden eliminar periodos que no tengan productos asociados. Si tienes productos en este periodo, elimínalos primero desde el catálogo.
    </p>
  </div>

  {#snippet footer()}
      <Button variant="secondary" onclick={closeDeleteModal}>Cancelar</Button>
      <Button variant="ghost" class="text-red-600 hover:bg-red-50" onclick={handleDelete}>Eliminar</Button>
  {/snippet}
</Modal>
