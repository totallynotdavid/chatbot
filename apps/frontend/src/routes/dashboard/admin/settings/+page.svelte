<script lang="ts">
import { onMount } from "svelte";
import { fetchApi } from "$lib/utils/api";
import { toast } from "$lib/state/toast.svelte";
import Button from "$lib/components/ui/button.svelte";
import Modal from "$lib/components/ui/modal.svelte";
import SectionShell from "$lib/components/ui/section-shell.svelte";

let settings = $state<Record<string, string>>({});
let initialSettings = $state<Record<string, string>>({});
let loading = $state(true);
let saving = $state(false);
let showConfirmModal = $state(false);

let hasChanges = $derived(
  JSON.stringify(settings) !== JSON.stringify(initialSettings),
);

async function loadSettings() {
  loading = true;
  try {
    const data = await fetchApi<Record<string, string>>("/api/admin/settings");
    settings = { ...data };
    initialSettings = { ...data };
  } catch (e) {
    console.error(e);
  } finally {
    loading = false;
  }
}

async function handleSave(e?: Event) {
  e?.preventDefault();
  showConfirmModal = true;
}

async function confirmSave() {
  saving = true;
  showConfirmModal = false;
  try {
    await fetchApi("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    initialSettings = { ...settings };
    toast.success("Configuración actualizada");
  } catch (e) {
    toast.error("Error al guardar configuración");
  } finally {
    saving = false;
  }
}

onMount(loadSettings);
</script>

<div class="space-y-6">
    <SectionShell 
        title="Control operativo" 
        description="Interruptores globales que afectan el comportamiento del bot."
    >
        {#if loading}
             <div class="p-8 space-y-4 animate-pulse">
                <div class="h-10 bg-cream-50 rounded w-full"></div>
            </div>
        {:else}
             <div class="p-6">
                 <!-- Maintenance Mode -->
                <div class="border border-red-100 bg-red-50/30 p-4 rounded transition-colors hover:bg-red-50/50">
                    <label class="flex items-start gap-3 cursor-pointer group">
                    <input
                        type="checkbox"
                        checked={settings["maintenance_mode"] === "true"}
                        onchange={(e) => settings["maintenance_mode"] = e.currentTarget.checked ? "true" : "false"}
                        class="mt-1 h-4 w-4 rounded border-red-300 text-red-600 focus:ring-red-600 focus:ring-offset-0 cursor-pointer"
                    />
                    <div class="flex-1">
                        <div class="font-bold text-sm text-red-900">
                           MODO MANTENIMIENTO
                        </div>
                        <p class="text-xs text-red-700/80 mt-1 leading-relaxed">
                            Al activar, el bot responderá con un mensaje de "fuera de servicio" a todos los usuarios y dejará de procesar conversaciones nuevas. Úselo con extrema precaución.
                        </p>
                    </div>
                    </label>
                </div>
             </div>
        {/if}
    </SectionShell>

    <SectionShell 
        title="Integraciones" 
        description="Gestión de conexiones con servicios externos."
    >
        {#if loading}
             <div class="p-8 space-y-4 animate-pulse">
                <div class="h-10 bg-cream-50 rounded w-full"></div>
                <div class="h-10 bg-cream-50 rounded w-full"></div>
            </div>
        {:else}
            <div class="divide-y divide-ink-100/50">
                <div class="p-6 hover:bg-cream-50/30 transition-colors">
                    <label class="flex items-start gap-3 cursor-pointer group">
                        <input
                        type="checkbox"
                        checked={settings["force_fnb_down"] === "true"}
                        onchange={(e) => settings["force_fnb_down"] = e.currentTarget.checked ? "true" : "false"}
                        class="mt-1 h-4 w-4 rounded border-ink-300 text-ink-900 focus:ring-ink-900 focus:ring-offset-0 cursor-pointer"
                        />
                        <div class="flex-1">
                        <div class="font-medium text-sm text-ink-900">
                            Suspender API FNB (Calidda)
                        </div>
                        <p class="text-xs text-ink-500 mt-1">
                            Forzar desconexión del servicio de elegibilidad. El sistema activará el mecanismo de fallback si está disponible.
                        </p>
                        </div>
                    </label>
                </div>

                <div class="p-6 hover:bg-cream-50/30 transition-colors">
                    <label class="flex items-start gap-3 cursor-pointer group">
                        <input
                        type="checkbox"
                        checked={settings["force_gaso_down"] === "true"}
                        onchange={(e) => settings["force_gaso_down"] = e.currentTarget.checked ? "true" : "false"}
                        class="mt-1 h-4 w-4 rounded border-ink-300 text-ink-900 focus:ring-ink-900 focus:ring-offset-0 cursor-pointer"
                        />
                        <div class="flex-1">
                        <div class="font-medium text-sm text-ink-900">
                            Suspender API PowerBI (GASO)
                        </div>
                        <p class="text-xs text-ink-500 mt-1">
                            Simular caída del servicio de reportes. Útil para desarrollo y validación de errores.
                        </p>
                        </div>
                    </label>
                </div>
            </div>
        {/if}
    </SectionShell>

    {#if hasChanges}
      <div class="sticky bottom-6 flex justify-end gap-3 bg-white/80 backdrop-blur-sm p-4 border border-ink-100 rounded shadow-lg animate-in slide-in-from-bottom-2">
        <Button 
          type="button" 
          variant="outline" 
          onclick={() => {
            settings = { ...initialSettings };
          }}
        >
          Descartar cambios
        </Button>
        <Button onclick={handleSave} disabled={saving}>
          {saving ? "Guardando..." : "Guardar configuración"}
        </Button>
      </div>
    {/if}
</div>

<Modal
  bind:open={showConfirmModal}
  title="Confirmar cambios"
  subtitle="Configuración del sistema"
  onClose={() => showConfirmModal = false}
  footer={footer}
>
  <div class="space-y-4">
    <p class="text-ink-600">
      Estás a punto de modificar la configuración global del sistema. 
      Estas acciones afectarán inmediatamente a los usuarios activos.
    </p>
    
    {#if settings["maintenance_mode"] === "true" && initialSettings["maintenance_mode"] !== "true"}
      <div class="p-4 bg-red-50 border border-red-100 rounded-md flex gap-3 text-red-800 text-sm">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <div>
          <div class="font-bold">Advertencia: Modo Mantenimiento</div>
          <div class="mt-1">El bot dejará de responder a todos los usuarios.</div>
        </div>
      </div>
    {/if}

    <div class="bg-cream-50 p-4 rounded text-sm font-mono border border-cream-200">
      <p class="text-xs text-ink-400 mb-2 uppercase tracking-wider">Cambios detectados:</p>
      <ul class="space-y-1">
        {#each Object.keys(settings) as key}
          {#if settings[key] !== initialSettings[key]}
            <li class="flex justify-between gap-4">
              <span class="text-ink-600">{key}</span>
              <span class="font-bold text-ink-900">
                {initialSettings[key]} → {settings[key]}
              </span>
            </li>
          {/if}
        {/each}
      </ul>
    </div>
  </div>
</Modal>

{#snippet footer()}
  <Button variant="outline" onclick={() => showConfirmModal = false}>
    Cancelar
  </Button>
  <Button onclick={confirmSave}>
    Confirmar aplicación
  </Button>
{/snippet}
