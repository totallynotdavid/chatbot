<script lang="ts">
import { onMount } from "svelte";
import { fetchApi } from "#lib/utils/api.js";
import { toast } from "#lib/state/toast.svelte.js";
import Button from "#lib/components/ui/button.svelte";
import Modal from "#lib/components/ui/modal.svelte";
import SectionShell from "#lib/components/ui/section-shell.svelte";

let settings = $state<Record<string, string>>({});
let initialSettings = $state<Record<string, string>>({});
let loading = $state(true);
let saving = $state(false);
let showConfirmModal = $state(false);

let hasChanges = $derived(
  JSON.stringify(settings) !== JSON.stringify(initialSettings),
);

// The Calidda integrations are shared platform infrastructure, not per
// business, so only VendeYa staff can suspend them. A tenant admin sees the
// current state read-only rather than a toggle that would silently no-op.
let canEditPlatformSettings = $derived(settings._scope === "platform");

// Where a platform switch's value is. An operator with no tenant selected
// owns these and edits them under their own names. A tenant admin sees them
// as `_platform_<key>`, which a save never posts back. Under the raw names, a
// save would resubmit them and the server would refuse the write.
function platformSwitchOn(key: string): boolean {
  return (
    settings[canEditPlatformSettings ? key : `_platform_${key}`] === "true"
  );
}

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
    // Only the writable keys go back. The underscore-prefixed ones are the
    // server's read-only commentary: the platform values and the scope. The
    // POST ignores them, and leaving them out keeps a save to what this page
    // owns.
    const payload = Object.fromEntries(
      Object.entries(settings).filter(([key]) => !key.startsWith("_")),
    );

    await fetchApi("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    initialSettings = { ...settings };
    toast.success("Configuración actualizada");
  } catch (e) {
    toast.error("Error al guardar configuración");
  } finally {
    saving = false;
  }
}

onMount(() => {
  loadSettings();
});
</script>

<div class="space-y-6">
  {#if !loading}
    <SectionShell
      title="Operaciones de Recuperación"
      description="Herramientas para recuperar conversiones afectadas por fallos del sistema."
    >
      <div class="p-6">
        <div class="border border-blue-100 bg-blue-50/30 p-4 rounded">
          <div class="flex items-start gap-3">
            <div class="flex-1">
              <div class="font-bold text-sm text-blue-900">
                Recuperación de Elegibilidad
              </div>
              <p class="text-xs text-blue-700/80 mt-1 leading-relaxed">
                Si hubo una caída de proveedores (Calidda/PowerBI), los usuarios
                pueden haber quedado en espera. Use este botón para reintentar
                la verificación de eligibilidad para todos los usuarios
                afectados.
              </p>

              {#await fetchApi<{ waitingCount: number }>("/api/admin/outage-status") then data}
                {#if data.waitingCount > 0}
                  <div
                    class="mt-2 flex items-center gap-2 text-xs font-bold text-orange-700 bg-orange-50 px-3 py-2 rounded border border-orange-100"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path
                        d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
                      />
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                    </svg>
                    {data.waitingCount} usuarios esperando recuperación
                  </div>
                {:else}
                  <div
                    class="mt-2 flex items-center gap-2 text-xs text-green-700 bg-green-50 px-3 py-2 rounded border border-green-100"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <path d="m9 11 3 3L22 4" />
                    </svg>
                    No hay usuarios en espera
                  </div>
                {/if}
              {/await}

              <div class="mt-3">
                <Button
                  size="sm"
                  onclick={async () => {
                    if (
                      !confirm(
                        "¿Estás seguro de reintentar la verificación para todos los usuarios en espera?",
                      )
                    )
                      return;
                    try {
                      const res = await fetchApi<{ message: string }>(
                        "/api/admin/retry-eligibility",
                        { method: "POST" },
                      );
                      toast.success(res.message);
                      // Force reload of status
                      await fetchApi("/api/admin/outage-status");
                    } catch (e) {
                      toast.error("Error al ejecutar recuperación");
                    }
                  }}
                >
                  Reintentar verificaciones pendientes
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SectionShell>
  {/if}

  <SectionShell
    title="Integraciones"
    description={canEditPlatformSettings
      ? "Gestión de conexiones con servicios externos."
      : "Conexiones compartidas de la plataforma. Solo el equipo de VendeYa puede modificarlas."}
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
              checked={platformSwitchOn("force_fnb_down")}
              disabled={!canEditPlatformSettings}
              onchange={(e) =>
                (settings["force_fnb_down"] = e.currentTarget.checked
                  ? "true"
                  : "false")}
              class="mt-1 h-4 w-4 rounded border-ink-300 text-ink-900 focus:ring-ink-900 focus:ring-offset-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div class="flex-1">
              <div class="font-medium text-sm text-ink-900">
                Suspender API FNB (Calidda)
              </div>
              <p class="text-xs text-ink-500 mt-1">
                Forzar desconexión del servicio de elegibilidad. El sistema
                activará el mecanismo de fallback si está disponible.
              </p>
            </div>
          </label>
        </div>

        <div class="p-6 hover:bg-cream-50/30 transition-colors">
          <label class="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={platformSwitchOn("force_gaso_down")}
              disabled={!canEditPlatformSettings}
              onchange={(e) =>
                (settings["force_gaso_down"] = e.currentTarget.checked
                  ? "true"
                  : "false")}
              class="mt-1 h-4 w-4 rounded border-ink-300 text-ink-900 focus:ring-ink-900 focus:ring-offset-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div class="flex-1">
              <div class="font-medium text-sm text-ink-900">
                Suspender API PowerBI (GASO)
              </div>
              <p class="text-xs text-ink-500 mt-1">
                Simular caída del servicio de reportes. Útil para desarrollo y
                validación de errores.
              </p>
            </div>
          </label>
        </div>
      </div>
    {/if}
  </SectionShell>

  {#if hasChanges}
    <div
      class="sticky bottom-6 flex justify-end gap-3 bg-white/80 backdrop-blur-sm p-4 border border-ink-100 rounded shadow-lg animate-in slide-in-from-bottom-2"
    >
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
  onClose={() => (showConfirmModal = false)}
  {footer}
>
  <div class="space-y-4">
    <p class="text-ink-600">
      Estás a punto de modificar la configuración global del sistema. Estas
      acciones afectarán inmediatamente a los usuarios activos.
    </p>

    <div
      class="bg-cream-50 p-4 rounded text-sm font-mono border border-cream-200"
    >
      <p class="text-xs text-ink-400 mb-2 uppercase tracking-wider">
        Cambios detectados:
      </p>
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
  <Button variant="outline" onclick={() => (showConfirmModal = false)}>
    Cancelar
  </Button>
  <Button onclick={confirmSave}>Confirmar aplicación</Button>
{/snippet}
