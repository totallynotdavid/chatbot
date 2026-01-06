<script lang="ts">
import { onMount } from "svelte";
import { fade } from "svelte/transition";
import Button from "$lib/components/ui/button.svelte";
import UserTable from "$lib/components/admin/user-table.svelte";
import { fetchApi } from "$lib/utils/api";

// Only users table logic here
type User = {
  id: string;
  username: string;
  name: string;
  role: string;
  is_active: number;
  created_at: string;
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

onMount(() => {
  loadUsers();
});
</script>

<div in:fade class="space-y-6">
    <!-- Stats Row -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="bg-white p-6 border border-cream-200">
            <p class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-2">Total usuarios</p>
            <p class="text-3xl font-mono text-ink-900">{users.length}</p>
        </div>
        <div class="bg-white p-6 border border-cream-200">
            <p class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-2">Usuarios activos</p>
            <p class="text-3xl font-mono text-green-700">{users.filter(u => u.is_active === 1).length}</p>
        </div>
        <div class="bg-white p-6 border border-cream-200">
             <div class="flex justify-between items-start">
                <div>
                    <p class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-2">Roles</p>
                    <div class="space-y-1">
                        <div class="flex items-center gap-2 text-xs">
                            <span class="w-2 h-2 rounded-full bg-red-500"></span>
                            <span>{users.filter(u => u.role === 'admin').length} Admin</span>
                        </div>
                        <div class="flex items-center gap-2 text-xs">
                            <span class="w-2 h-2 rounded-full bg-yellow-500"></span>
                            <span>{users.filter(u => u.role === 'developer').length} Dev</span>
                        </div>
                        <div class="flex items-center gap-2 text-xs">
                            <span class="w-2 h-2 rounded-full bg-blue-500"></span>
                            <span>{users.filter(u => u.role === 'supervisor').length} Supervisor</span>
                        </div>
                        <div class="flex items-center gap-2 text-xs">
                             <span class="w-2 h-2 rounded-full bg-green-500"></span>
                            <span>{users.filter(u => u.role === 'sales_agent').length} Agentes</span>
                        </div>
                    </div>
                </div>
                <Button href="/dashboard/admin/users/create">
                   + Nuevo usuario
                </Button>
             </div>
        </div>
    </div>

    <!-- Table -->
    {#if loading}
        <div class="p-12 text-center text-ink-400 animate-pulse">Cargando usuarios...</div>
    {:else}
        <UserTable {users} />
    {/if}
</div>
