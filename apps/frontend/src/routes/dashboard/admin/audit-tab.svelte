<script lang="ts">
import { onMount } from "svelte";
import { fetchApi } from "$lib/utils/api";
import { formatDateTime } from "$lib/utils/formatters";
import type { AuditLog } from "@totem/types";

type AuditLogWithName = AuditLog & { user_name?: string; user_username?: string };
let logs = $state<AuditLogWithName[]>([]);
let loading = $state(true);

const actionLabels: Record<string, string> = {
  create_user: "Creó usuario",
  toggle_user_status: "Cambió estado usuario",
  update_user_role: "Cambió rol de usuario",
  reset_password: "Reseteó password",
  update_settings: "Actualizó configuración",
  update_order_status: "Actualizó orden",
  create_product: "Creó producto",
  update_product: "Actualizó producto",
  delete_product: "Eliminó producto",
  bulk_import: "Importación masiva",
  bulk_update_products: "Actualización masiva",
};

async function loadLogs() {
  loading = true;
  try {
    const res = await fetchApi<{ logs: AuditLogWithName[] }>(
      "/api/admin/audit?limit=100",
    );
    logs = res.logs;
  } catch (e) {
    console.error(e);
  } finally {
    loading = false;
  }
}

onMount(() => loadLogs());
</script>

<div class="bg-white border border-cream-200 overflow-hidden">
    <div class="p-4 border-b border-cream-200 bg-cream-50 flex justify-between items-center">
        <h3 class="font-serif text-lg">Registro de cambios (últimos 100)</h3>
        <button onclick={loadLogs} class="text-xs text-ink-500 hover:text-ink-900">Actualizar</button>
    </div>
    
    {#if loading}
        <div class="p-12 text-center text-ink-400">Cargando logs...</div>
    {:else}
        <table class="w-full text-sm">
            <thead>
                <tr class="text-left text-xs uppercase text-ink-400 border-b border-cream-100">
                    <th class="p-3">Fecha</th>
                    <th class="p-3">Usuario</th>
                    <th class="p-3">Acción</th>
                    <th class="p-3">Recurso</th>
                    <th class="p-3">Detalles</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-cream-100">
                {#each logs as log}
                    <tr class="hover:bg-cream-50/50">
                        <td class="p-3 font-mono text-xs whitespace-nowrap text-ink-500">
                            {formatDateTime(log.created_at)}
                        </td>
                        <td class="p-3 font-medium" title={log.user_username || log.user_id}>{log.user_name || log.user_id}</td>
                        <td class="p-3">
                            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                                {actionLabels[log.action] || log.action}
                            </span>
                        </td>
                        <td class="p-3 text-xs text-ink-500">
                            {log.resource_type} / {log.resource_id || '-'}
                        </td>
                        <td class="p-3 text-xs font-mono text-ink-400 truncate max-w-xs" title={log.metadata}>
                            {log.metadata === "{}" ? "" : log.metadata}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}
</div>
