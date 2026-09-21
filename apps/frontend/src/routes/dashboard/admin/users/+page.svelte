<script lang="ts">
import { onMount } from "svelte";
import Button from "$lib/components/ui/button.svelte";
import SectionShell from "$lib/components/ui/section-shell.svelte";
import DataTable from "$lib/components/ui/data-table.svelte";
import { fetchApi } from "$lib/utils/api";
import { formatDate } from "$lib/utils/formatters";

type User = {
  id: string;
  username: string;
  name: string;
  role: string;
  is_active: number;
  created_at: number;
};

let users = $state<User[]>([]);
let loading = $state(true);

async function loadUsers() {
  loading = true;
  try {
    const res = await fetchApi<{ users: User[] }>("/api/admin/users");
    users = res.users;
  } catch (e) {
    console.error(e);
  } finally {
    loading = false;
  }
}

onMount(loadUsers);

const roleLabels: Record<string, string> = {
  admin: "Administrador",
  developer: "Desarrollador",
  supervisor: "Supervisor",
  sales_agent: "Agente de ventas",
};

const roleVariants: Record<string, string> = {
  admin: "error",
  developer: "warning",
  supervisor: "default",
  sales_agent: "success",
};

const badgeColors: Record<string, string> = {
  error: "bg-red-100 text-red-800",
  warning: "bg-yellow-100 text-yellow-800",
  success: "bg-green-100 text-green-800",
  default: "bg-gray-100 text-gray-800",
};

const columns = [
  { header: "Nombre / Usuario", cell: nameCell },
  { header: "Rol", cell: roleCell },
  { header: "Estado", cell: statusCell },
  { header: "Creado", cell: createdCell },
  { header: "Acciones", align: "right" as const, cell: actionsCell },
];
</script>

<div class="space-y-6">
    <SectionShell 
        title="Usuarios del sistema" 
        description="Gestión de accesos y roles del equipo."
        action={headerAction}
    >
        <DataTable 
            data={users} 
            {columns}
            {loading} 
            emptyMessage="No hay usuarios registrados."
        />
    </SectionShell>
</div>

{#snippet headerAction()}
    <Button href="/dashboard/admin/users/create">
        + Nuevo Usuario
    </Button>
{/snippet}

{#snippet badge(label: string, variant: string)}
    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {badgeColors[variant] || badgeColors.default}">{label}</span>
{/snippet}

{#snippet nameCell(u: User)}
    <div>
        <div class="font-serif font-medium text-ink-900">{u.name}</div>
        <div class="text-xs text-ink-500 font-mono">@{u.username}</div>
    </div>
{/snippet}

{#snippet roleCell(u: User)}
    {@render badge(roleLabels[u.role] || u.role, roleVariants[u.role] || "default")}
{/snippet}

{#snippet statusCell(u: User)}
    {@render badge(
        u.is_active ? "ACTIVO" : "INACTIVO",
        u.is_active ? "success" : "default",
    )}
{/snippet}

{#snippet createdCell(u: User)}
    <span class="text-ink-500 font-mono text-xs">{formatDate(u.created_at)}</span>
{/snippet}

{#snippet actionsCell(u: User)}
    <a
        href="/dashboard/admin/users/{u.id}"
        class="text-xs font-bold uppercase tracking-wider text-ink-900 hover:text-ink-600 hover:underline"
    >Gestionar &rarr;</a>
{/snippet}
