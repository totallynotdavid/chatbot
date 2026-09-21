<script lang="ts">
import { onMount } from "svelte";
import { fetchApi } from "$lib/utils/api";
import { formatDateTime } from "$lib/utils/formatters";
import type { AuditLog } from "@vendeya/types";
import SectionShell from "$lib/components/ui/section-shell.svelte";
import DataTable from "$lib/components/ui/data-table.svelte";
import Button from "$lib/components/ui/button.svelte";

type AuditLogWithName = AuditLog & {
  user_name?: string;
  user_username?: string | null;
};
let logs = $state<AuditLogWithName[]>([]);
let loading = $state(true);

const actionLabels: Record<string, string> = {
  create_user: "Creó usuario",
  promote_platform_operator: "Promovió a operador de plataforma",
  toggle_user_status: "Cambió estado",
  update_user_role: "Cambió rol",
  reset_password: "Reseteó password",
  update_settings: "Configuración",
  update_order_status: "Orden",
  create_product: "Creó producto",
  update_product: "Actualizó producto",
  delete_product: "Eliminó producto",
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

onMount(loadLogs);

const columns = [
  { header: "Fecha", cell: dateCell },
  { header: "Usuario", cell: userCell },
  { header: "Acción", cell: actionCell },
  { header: "Recurso", cell: resourceCell },
  { header: "Detalles", cell: detailsCell },
];
</script>

<SectionShell 
    title="Registro de auditoría" 
    description="Últimos 100 eventos del sistema."
    action={refreshAction}
>
    <DataTable 
        data={logs} 
        {columns} 
        {loading} 
        emptyMessage="No hay registros de auditoría recientes."
    />
</SectionShell>

{#snippet refreshAction()}
    <Button variant="secondary" onclick={loadLogs} disabled={loading}>
        {#if loading}
            Cargando...
        {:else}
            Actualizar
        {/if}
    </Button>
{/snippet}

{#snippet dateCell(item: AuditLogWithName)}
    <span class="font-mono text-xs text-ink-500">{formatDateTime(item.created_at)}</span>
{/snippet}

{#snippet userCell(item: AuditLogWithName)}
    <div class="leading-tight">
        {item.user_name || item.actor}{#if item.user_username}<br><span class="text-xs text-ink-400 font-mono">@{item.user_username}</span>{/if}
    </div>
{/snippet}

{#snippet actionCell(item: AuditLogWithName)}
    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 border border-gray-200 shadow-sm">{actionLabels[item.action] || item.action}</span>
{/snippet}

{#snippet resourceCell(item: AuditLogWithName)}
    <div class="text-xs text-ink-500">{item.resource_type}<br>{item.resource_id || "-"}</div>
{/snippet}

{#snippet detailsCell(item: AuditLogWithName)}
    {#if !item.metadata || item.metadata === "{}"}
        <span class="text-ink-300">-</span>
    {:else}
        <code class="text-[10px] bg-cream-50 p-1 rounded border border-cream-100 block max-w-xs truncate" title={item.metadata}>{item.metadata}</code>
    {/if}
{/snippet}
