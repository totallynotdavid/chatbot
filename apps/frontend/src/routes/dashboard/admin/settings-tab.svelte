<script lang="ts">
import { onMount } from "svelte";
import { fetchApi } from "$lib/utils/api";
import { toast } from "$lib/state/toast.svelte";
import Button from "$lib/components/ui/button.svelte";
import Badge from "$lib/components/ui/badge.svelte";

let settings = $state<Record<string, string>>({});
let loading = $state(true);
let saving = $state(false);

async function loadSettings() {
  loading = true;
  try {
    settings = await fetchApi<Record<string, string>>("/api/admin/settings");
  } catch (e) {
    console.error(e);
  } finally {
    loading = false;
  }
}

async function saveSettings() {
  if (!confirm("¿Guardar cambios en la configuración global?")) return;

  saving = true;
  try {
    await fetchApi("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    toast.success("Configuración actualizada");
  } catch (e) {
    toast.error("Error al guardar configuración");
  } finally {
    saving = false;
  }
}

onMount(loadSettings);

function toggleSetting(key: string) {
  settings[key] = settings[key] === "true" ? "false" : "true";
}
</script>

<div class="max-w-4xl space-y-8">
    <div class="bg-white border border-cream-200 p-8 shadow-sm">
        <div class="flex justify-between items-start mb-6">
            <div>
                 <h2 class="text-xl font-serif text-ink-900">Control de Sistema</h2>
                 <p class="text-sm text-ink-500 mt-1">Interruptores globales y configuración operativa del bot.</p>
            </div>
            <Button onclick={saveSettings} disabled={saving}>
                {saving ? "Guardando..." : "Guardar Cambios"}
            </Button>
        </div>

        {#if loading}
            <div class="animate-pulse space-y-4">
                <div class="h-12 bg-gray-100 rounded"></div>
                <div class="h-12 bg-gray-100 rounded"></div>
            </div>
        {:else}
            <div class="space-y-6 divide-y divide-cream-100">
                <!-- Maintenance Mode -->
                <div class="pt-6 first:pt-0 flex items-center justify-between">
                    <div>
                        <p class="font-bold text-ink-900 mb-1">Modo mantenimiento</p>
                        <p class="text-xs text-ink-500 max-w-md">
                            Si se activa, el bot responderá con un mensaje de "fuera de servicio" 
                            a todos los usuarios y no procesará nuevas conversaciones.
                        </p>
                    </div>
                    <button 
                        role="switch" 
                        aria-checked={settings["maintenance_mode"] === "true"}
                        onclick={() => toggleSetting("maintenance_mode")}
                        class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ink-900 focus:ring-offset-2 {settings["maintenance_mode"] === "true" ? 'bg-red-600' : 'bg-gray-200'}"
                    >
                        <span class="sr-only">Activar mantener</span>
                        <span class="translate-x-1 inline-block h-4 w-4 transform rounded-full bg-white transition {settings["maintenance_mode"] === "true" ? 'translate-x-6' : 'translate-x-1'}"></span>
                    </button>
                </div>

                <!-- Force Provider Status -->
                <div class="pt-6 flex items-center justify-between">
                    <div>
                        <p class="font-bold text-ink-900 mb-1">API FNB (Calidda)</p>
                        <p class="text-xs text-ink-500">Controla manualmente si el sistema consulta la API de Calidda.</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <Badge variant={settings["force_fnb_down"] === "true" ? "error" : "success"}>
                            {settings["force_fnb_down"] === "true" ? "FORZAR APAGADO" : "OPERATIVO HABILITADO"}
                        </Badge>
                         <button 
                            onclick={() => toggleSetting("force_fnb_down")}
                            class="text-xs underline text-ink-500 hover:text-ink-900 ml-2"
                        >
                            Cambiar
                        </button>
                    </div>
                </div>

                 <div class="pt-6 flex items-center justify-between">
                    <div>
                        <p class="font-bold text-ink-900 mb-1">API PowerBI (GASO)</p>
                        <p class="text-xs text-ink-500">Controla manualmente si el sistema consulta PowerBI.</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <Badge variant={settings["force_gaso_down"] === "true" ? "error" : "success"}>
                            {settings["force_gaso_down"] === "true" ? "FORZAR APAGADO" : "OPERATIVO HABILITADO"}
                        </Badge>
                         <button 
                            onclick={() => toggleSetting("force_gaso_down")}
                            class="text-xs underline text-ink-500 hover:text-ink-900 ml-2"
                        >
                            Cambiar
                        </button>
                    </div>
                </div>
            </div>
        {/if}
    </div>
</div>
