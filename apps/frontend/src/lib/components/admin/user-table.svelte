<script lang="ts">
import Badge from "$lib/components/ui/badge.svelte";
import { formatDate } from "$lib/utils/formatters";
import { fetchApi } from "$lib/utils/api";

type User = {
  id: string;
  username: string;
  name: string;
  role: string;
  is_active: number;
  created_at: string;
};

type Props = {
  users: User[];
  onUpdate: () => void;
};

let { users, onUpdate }: Props = $props();

const roleLabels = {
  admin: "Administrador",
  developer: "Desarrollador",
  sales_agent: "Agente de ventas",
};

const roleVariants = {
  admin: "error" as const,
  developer: "warning" as const,
  sales_agent: "success" as const,
};

async function toggleUserStatus(userId: string) {
  await fetchApi(`/api/admin/users/${userId}/status`, { method: "PATCH" });
  onUpdate();
}

async function resetPassword(userId: string) {
  const newPass = prompt("Nueva contraseña:");
  if (!newPass) return;

  await fetchApi(`/api/admin/users/${userId}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ newPassword: newPass }),
  });

  alert(
    "Contraseña actualizada. Todas las sesiones del usuario fueron invalidadas.",
  );
}
</script>

<div class="bg-white border border-cream-200 shadow-sm">
	<div class="border-b border-cream-200 p-6">
		<h2 class="text-2xl font-serif">Usuarios registrados</h2>
	</div>
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead class="bg-cream-100 font-mono text-xs uppercase tracking-wider">
				<tr>
					<th class="text-left p-4">Nombre</th>
					<th class="text-left p-4">Usuario</th>
					<th class="text-left p-4">Rol</th>
					<th class="text-left p-4">Estado</th>
					<th class="text-left p-4">Creado</th>
					<th class="text-right p-4">Acciones</th>
				</tr>
			</thead>
			<tbody class="font-mono text-xs">
				{#each users as user (user.id)}
					<tr class="border-b border-cream-100 hover:bg-cream-50">
						<td class="p-4 font-serif text-base">{user.name}</td>
						<td class="p-4">{user.username}</td>
						<td class="p-4">
							<Badge variant={roleVariants[user.role as keyof typeof roleVariants]}>
								{roleLabels[user.role as keyof typeof roleLabels]}
							</Badge>
						</td>
						<td class="p-4">
							<Badge variant={user.is_active === 1 ? "success" : "error"}>
								{user.is_active === 1 ? "ACTIVO" : "INACTIVO"}
							</Badge>
						</td>
						<td class="p-4 text-ink-400">{formatDate(user.created_at)}</td>
						<td class="p-4 text-right space-x-2">
							<button
								onclick={() => toggleUserStatus(user.id)}
								class="text-xs hover:underline text-ink-600"
							>
								{user.is_active === 1 ? "Desactivar" : "Activar"}
							</button>
							<button
								onclick={() => resetPassword(user.id)}
								class="text-xs hover:underline text-blue-600"
							>
								Restablecer
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
