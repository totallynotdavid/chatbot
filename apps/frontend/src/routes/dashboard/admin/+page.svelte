<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { fetchApi } from "$lib/utils/api";
import PageHeader from "$lib/components/shared/page-header.svelte";
import UserForm from "$lib/components/admin/user-form.svelte";
import UserTable from "$lib/components/admin/user-table.svelte";
import StatsCard from "$lib/components/admin/stats-card.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

let users = $state<any[]>([]);

async function loadUsers() {
  const response = await fetchApi<{ users: any[] }>("/api/admin/users");
  users = response.users;
}

onMount(() => {
  if (!data.user) {
    goto("/login");
    return;
  }
  if (data.user.role !== "admin") {
    goto("/dashboard");
    return;
  }
  loadUsers();
});
</script>

<PageTitle title="Administración" />

<div class="max-w-6xl mx-auto p-8 md:p-12 min-h-screen">
	<PageHeader title="Gestión de usuarios" subtitle="Configuración" />

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
		<div class="bg-white p-8 border border-cream-200 shadow-sm">
			<h2 class="text-xl font-serif mb-6">Registrar nuevo usuario</h2>
			<UserForm onSuccess={loadUsers} />
		</div>

		<div class="bg-cream-50 p-8 border border-cream-200">
			<h2 class="text-xl font-serif mb-6">Estadísticas del sistema</h2>
			<div class="space-y-4">
				<StatsCard label="Total de usuarios" value={users.length} />
				<StatsCard
					label="Usuarios activos"
					value={users.filter((u) => u.is_active === 1).length}
					variant="success"
				/>
				<StatsCard
					label="Administradores"
					value={users.filter((u) => u.role === "admin").length}
				/>
			</div>
		</div>
	</div>

	<UserTable {users} onUpdate={loadUsers} />
</div>
