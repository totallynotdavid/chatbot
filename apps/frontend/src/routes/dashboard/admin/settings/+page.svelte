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
  let heldMessagesCount = $state(0);
  let processingHeld = $state(false);

  let hasChanges = $derived(
    JSON.stringify(settings) !== JSON.stringify(initialSettings),
  );

  // For a tenant admin, `maintenance_mode` is the tenant's own stored setting.
  // The platform-wide freeze is a separate read-only value, and the bot is held
  // when either one says so. Keep them apart, because a save posts every key
  // without an underscore prefix and a combined value would write the platform
  // freeze into the tenant's own row.
  let platformFrozen = $derived(
    settings["_platform_maintenance_mode"] === "true",
  );

  // Derived from the two raw values rather than read from the server's
  // `_effective_maintenance_mode`, so it follows the toggle as it moves instead
  // of lagging a save behind. An operator with no tenant selected gets the
  // platform value under `maintenance_mode`, and `platformFrozen` stays false.
  let effectivelyFrozen = $derived(
    settings["maintenance_mode"] === "true" || platformFrozen,
  );

  // The Calidda integrations are shared platform infrastructure, not per
  // business, so only VendeYa staff can suspend them. A tenant admin sees the
  // current state read-only rather than a toggle that would silently no-op.
  let canEditPlatformSettings = $derived(settings["_scope"] === "platform");

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
      const data = await fetchApi<Record<string, string>>(
        "/api/admin/settings",
      );
      settings = { ...data };
      initialSettings = { ...data };
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }

  async function checkHeldMessagesStatus() {
    try {
      const data = await fetchApi<{ pendingCount: number }>(
        "/api/admin/held-messages-status",
      );
      heldMessagesCount = data.pendingCount;
    } catch (e) {
      console.error(e);
    }
  }

  async function processHeldMessages() {
    processingHeld = true;
    try {
      const result = await fetchApi<{
        success: boolean;
        message: string;
        stats: {
          usersProcessed: number;
          messagesProcessed: number;
          errors: number;
          stillAnswering: number;
        };
      }>("/api/admin/process-held-messages", {
        method: "POST",
      });

      toast.success(result.message);

      // Update count after success
      await checkHeldMessagesStatus();
    } catch (e) {
      toast.error("Error al procesar mensajes retenidos");
    } finally {
      processingHeld = false;
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
      // Capture old state before update
      const wasInMaintenance = initialSettings["maintenance_mode"] === "true";
      const isExitingMaintenance =
        wasInMaintenance && settings["maintenance_mode"] === "false";

      // Only the writable keys go back. The underscore-prefixed ones are the
      // server's read-only commentary: the platform freeze, the effective freeze
      // and the scope. The POST ignores them, and leaving them out keeps a save
      // to what this page owns.
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

      // Check for held messages if exiting maintenance mode
      if (isExitingMaintenance) {
        await checkHeldMessagesStatus();
      }
    } catch (e) {
      toast.error("Error al guardar configuración");
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    loadSettings();
    checkHeldMessagesStatus();
  });
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
        <div
          class="border border-red-100 bg-red-50/30 p-4 rounded transition-colors hover:bg-red-50/50"
        >
          <label class="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings["maintenance_mode"] === "true"}
              onchange={(e) =>
                (settings["maintenance_mode"] = e.currentTarget.checked
                  ? "true"
                  : "false")}
              class="mt-1 h-4 w-4 rounded border-red-300 text-red-600 focus:ring-red-600 focus:ring-offset-0 cursor-pointer"
            />
            <div class="flex-1">
              <div class="font-bold text-sm text-red-900">
                MODO MANTENIMIENTO
              </div>
              <p class="text-xs text-red-700/80 mt-1 leading-relaxed">
                Al activar, el bot responderá con un mensaje de "fuera de
                servicio" a todos los usuarios y dejará de procesar
                conversaciones nuevas. Úselo con extrema precaución.
              </p>
            </div>
          </label>
        </div>

        <!--
          A platform-wide freeze holds this business's messages whatever the
          toggle above says. It is shown apart from the toggle, because folding
          it in would write VendeYa's freeze into this tenant's own setting on
          the next save.
        -->
        {#if platformFrozen}
          <div
            class="mt-4 border border-amber-100 bg-amber-50/40 p-4 rounded text-amber-900"
          >
            <div class="font-bold text-sm">
              Mantenimiento global activo en la plataforma
            </div>
            <p class="text-xs text-amber-800/80 mt-1 leading-relaxed">
              VendeYa tiene el modo mantenimiento activado para todas las
              cuentas, así que el bot está retenido aunque el interruptor de
              arriba esté apagado. Ese interruptor solo controla el
              mantenimiento de esta cuenta; guardar cambios en esta página no
              lo modifica.
            </p>
          </div>
        {/if}
      </div>
    {/if}
  </SectionShell>

  <!-- Held messages status (shown when maintenance mode is off but messages pending) -->
  {#if !loading && !effectivelyFrozen && heldMessagesCount > 0}
    <SectionShell
      title="Mensajes retenidos"
      description="Mensajes recibidos durante el modo mantenimiento pendientes de procesamiento."
    >
      <div class="p-6">
        <div class="border border-amber-100 bg-amber-50/30 p-4 rounded">
          <div class="flex items-start gap-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="text-amber-600 shrink-0 mt-0.5"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div class="flex-1">
              <div class="font-bold text-sm text-amber-900">
                {heldMessagesCount}
                {heldMessagesCount === 1
                  ? "mensaje retenido"
                  : "mensajes retenidos"}
              </div>
              <p class="text-xs text-amber-700/80 mt-1 leading-relaxed">
                Estos mensajes fueron recibidos mientras el bot estaba en modo
                mantenimiento. El sistema los agregará por usuario y procesará
                sus conversaciones automáticamente.
              </p>
              <div class="mt-3">
                <Button
                  size="sm"
                  onclick={processHeldMessages}
                  disabled={processingHeld}
                >
                  {processingHeld ? "Procesando..." : "Procesar mensajes ahora"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SectionShell>
  {/if}

  <!-- Recovery operations section -->
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

    {#if settings["maintenance_mode"] === "true" && initialSettings["maintenance_mode"] !== "true"}
      <div
        class="p-4 bg-red-50 border border-red-100 rounded-md flex gap-3 text-red-800 text-sm"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          class="shrink-0"
        >
          <path
            d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
          />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <div>
          <div class="font-bold">Advertencia: Modo Mantenimiento</div>
          <div class="mt-1">
            El bot dejará de responder a todos los usuarios.
          </div>
        </div>
      </div>
    {/if}

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
