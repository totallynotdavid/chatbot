<script lang="ts">
import { onMount } from "svelte";
import { user } from "$lib/state.svelte";
import { goto } from "$app/navigation";

let users = $state<any[]>([]);
let newUsername = $state("");
let newPassword = $state("");
let newName = $state("");
let newRole = $state("sales_agent");
let message = $state("");

async function loadUsers() {
    const res = await fetch("/api/admin/users");
    if (res.ok) {
        const data = await res.json();
        users = data.users;
    }
}

async function createUser() {
    if (!newUsername || !newPassword || !newName) {
        message = "Todos los campos son obligatorios";
        return;
    }

    const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: newUsername,
            password: newPassword,
            name: newName,
            role: newRole,
        }),
    });

    if (res.ok) {
        message = `Usuario ${newUsername} creado correctamente.`;
        newUsername = "";
        newPassword = "";
        newName = "";
        await loadUsers();
    } else {
        const error = await res.json();
        message = error.error || "Error al crear usuario";
    }
}

async function toggleUserStatus(userId: string) {
    const res = await fetch(`/api/admin/users/${userId}/status`, {
        method: "PATCH",
    });
    if (res.ok) {
        await loadUsers();
    }
}

async function resetPassword(userId: string) {
    const newPass = prompt("Nueva contraseña:");
    if (!newPass) return;

    const res = await fetch(`/api/admin/users/${userId}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: newPass }),
    });

    if (res.ok) {
        alert(
            "Contraseña actualizada. Todas las sesiones del usuario fueron invalidadas.",
        );
    }
}

onMount(() => {
    if (!user.isAuthenticated) {
        goto("/login");
        return;
    }
    if (user.data?.role !== "admin") {
        goto("/dashboard");
        return;
    }
    loadUsers();
});

function getRoleBadgeClass(role: string) {
    if (role === "admin") return "bg-red-100 text-red-800 border-red-200";
    if (role === "developer")
        return "bg-blue-100 text-blue-800 border-blue-200";
    return "bg-green-100 text-green-800 border-green-200";
}

function getRoleLabel(role: string) {
    if (role === "admin") return "Administrador";
    if (role === "developer") return "Desarrollador";
    return "Agente de ventas";
}
</script>

<div class="page-container max-w-6xl">
  <div class="module-header">
    <div>
      <span class="module-subtitle">Configuración</span>
      <h1 class="module-title">Gestión de usuarios</h1>
    </div>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
    <!-- Create User Form -->
    <div class="bg-white p-8 border border-cream-200 shadow-sm">
      <h2 class="text-xl font-serif mb-6">Registrar nuevo usuario</h2>

      <form
        onsubmit={(e) => {
          e.preventDefault();
          createUser();
        }}
        class="space-y-6"
      >
        <div class="input-group">
          <label for="new-name" class="input-label">Nombre completo</label>
          <input id="new-name" bind:value={newName} type="text" class="input-field" placeholder="Juan Pérez" required />
        </div>

        <div class="input-group">
          <label for="new-username" class="input-label">Nombre de usuario</label>
          <input id="new-username" bind:value={newUsername} type="text" class="input-field" placeholder="jperez" required />
        </div>

        <div class="input-group">
          <label for="new-password" class="input-label">Contraseña temporal</label>
          <input id="new-password" bind:value={newPassword} type="password" class="input-field" required />
        </div>

        <div class="input-group">
          <label for="new-role" class="input-label">Rol de acceso</label>
          <select id="new-role" bind:value={newRole} class="input-select">
            <option value="sales_agent">Agente de ventas</option>
            <option value="developer">Desarrollador</option>
            <option value="admin">Administrador</option>
          </select>
        </div>

        {#if message}
          <div class={`p-4 text-sm font-serif italic border ${message.includes("Error") || message.includes("obligatorios") ? "bg-red-50 text-red-800 border-red-200" : "bg-green-50 text-green-800 border-green-200"}`}>
            {message}
          </div>
        {/if}

        <button type="submit" class="btn-primary w-full">Crear credenciales</button>
      </form>
    </div>

    <!-- Stats -->
    <div class="bg-cream-50 p-8 border border-cream-200">
      <h2 class="text-xl font-serif mb-6">Estadísticas del sistema</h2>
      <div class="space-y-4">
        <div class="flex justify-between items-baseline border-b border-cream-200 pb-2">
          <span class="text-sm text-ink-600">Total de usuarios</span>
          <span class="text-2xl font-serif font-bold">{users.length}</span>
        </div>
        <div class="flex justify-between items-baseline border-b border-cream-200 pb-2">
          <span class="text-sm text-ink-600">Usuarios activos</span>
          <span class="text-2xl font-serif font-bold text-green-700">
            {users.filter((u) => u.is_active === 1).length}
          </span>
        </div>
        <div class="flex justify-between items-baseline border-b border-cream-200 pb-2">
          <span class="text-sm text-ink-600">Administradores</span>
          <span class="text-2xl font-serif font-bold">{users.filter((u) => u.role === "admin").length}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- User Table -->
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
          {#each users as u}
            <tr class="border-b border-cream-100 hover:bg-cream-50">
              <td class="p-4 font-serif text-base">{u.name}</td>
              <td class="p-4">{u.username}</td>
              <td class="p-4">
                <span class={`px-2 py-1 text-[10px] font-bold border ${getRoleBadgeClass(u.role)}`}>
                  {getRoleLabel(u.role)}
                </span>
              </td>
              <td class="p-4">
                <span class={`px-2 py-1 text-[10px] font-bold ${u.is_active === 1 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                  {u.is_active === 1 ? "ACTIVO" : "INACTIVO"}
                </span>
              </td>
              <td class="p-4 text-ink-400">{new Date(u.created_at).toLocaleDateString()}</td>
              <td class="p-4 text-right space-x-2">
                <button onclick={() => toggleUserStatus(u.id)} class="text-xs hover:underline text-ink-600">
                  {u.is_active === 1 ? "Desactivar" : "Activar"}
                </button>
                <button onclick={() => resetPassword(u.id)} class="text-xs hover:underline text-blue-600">
                  Resetear contraseña
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
