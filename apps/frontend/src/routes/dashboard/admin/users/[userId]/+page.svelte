<script lang="ts">
import { onMount } from "svelte";
import { page } from "$app/stores";
import { goto } from "$app/navigation";
import { fetchApi } from "$lib/utils/api";
import { toast } from "$lib/state/toast.svelte";
import Button from "$lib/components/ui/button.svelte";
import FormField from "$lib/components/ui/form-field.svelte";
import Select from "$lib/components/ui/select.svelte";
import Badge from "$lib/components/ui/badge.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import PermissionMatrix from "$lib/components/admin/permission-matrix.svelte";

let user = $state<any>(null);
let originalRole = $state<string>("");
let saving = $state(false);

const userId = $page.params.userId;

async function loadUser() {
  try {
    const res = await fetchApi<{ users: any[] }>("/api/admin/users");
    user = res.users.find((u) => u.id === userId);
    if (user) {
      originalRole = user.role;
    }
  } catch (e) {
    console.error(e);
    toast.error("Error al cargar usuario");
  }
}

async function saveChanges() {
  if (!user) return;

  // Only save if role changed
  if (user.role === originalRole) {
    toast.info("No hay cambios para guardar");
    return;
  }

  saving = true;
  try {
    await fetchApi(`/api/admin/users/${user.id}/role`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: user.role }),
    });
    originalRole = user.role;
    toast.success("Rol actualizado correctamente");
    goto("/dashboard/admin");
  } catch (e) {
    toast.error("Error al actualizar rol");
  } finally {
    saving = false;
  }
}

async function toggleStatus() {
  if (!user) return;
  try {
    await fetchApi(`/api/admin/users/${user.id}/status`, { method: "PATCH" });
    user.is_active = user.is_active === 1 ? 0 : 1;
    toast.success(`Usuario ${user.is_active ? "activado" : "desactivado"}`);
  } catch (e) {
    toast.error("Error al cambiar estado");
  }
}

async function resetPassword() {
  const newPass = prompt("Nueva contraseña:");
  if (!newPass) return;

  try {
    await fetchApi(`/api/admin/users/${user.id}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: newPass }),
    });
    toast.success("Contraseña actualizada");
  } catch (e) {
    toast.error("Error al actualizar contraseña");
  }
}

onMount(loadUser);
</script>

<PageTitle title={user ? `Editar ${user.username}` : "Cargando..."} />

<div class="max-w-3xl mx-auto p-8 md:p-12">
    <div class="mb-8">
        <button onclick={() => goto("/dashboard/admin")} class="text-xs text-ink-400 hover:text-ink-600 mb-2 flex items-center gap-1">
            <span>&larr;</span> Volver a lista
        </button>
        {#if user}
            <div class="flex items-center gap-4">
                <h1 class="text-3xl font-serif text-ink-900">{user.name}</h1>
                <Badge variant={user.is_active ? "success" : "error"}>
                    {user.is_active ? "ACTIVO" : "INACTIVO"}
                </Badge>
            </div>
            <p class="text-ink-500 font-mono text-sm mt-1">{user.username}</p>
        {:else}
            <div class="h-10 bg-gray-100 rounded w-1/3 animate-pulse"></div>
        {/if}
    </div>

    {#if user}
        <div class="space-y-8">
            <!-- Role & Permissions Section -->
            <div class="bg-white border border-cream-200 shadow-sm p-8">
                <h2 class="text-lg font-serif mb-6 border-b border-cream-100 pb-2">Rol y Permisos</h2>
                
                <div class="space-y-6">
                    <FormField label="Rol asignado" for="role">
                        <Select
                            id="role"
                            bind:value={user.role}
                            items={[
                                { value: "sales_agent", label: "Agente de ventas" },
                                { value: "supervisor", label: "Supervisor" },
                                { value: "developer", label: "Desarrollador" },
                                { value: "admin", label: "Administrador" },
                            ]}
                        />
                        <p class="text-xs text-ink-400 mt-2">
                            Advertencia: Cambiar el rol modificará inmediatamente los accesos del usuario.
                        </p>
                    </FormField>

                    <PermissionMatrix role={user.role} />
                </div>
            </div>

            <!-- Security Section -->
            <div class="bg-white border border-cream-200 shadow-sm p-8">
                <h2 class="text-lg font-serif mb-6 border-b border-cream-100 pb-2">Seguridad y Acceso</h2>
                
                <div class="flex items-center justify-between py-4 border-b border-cream-100">
                    <div>
                        <p class="font-bold text-ink-900">Estado de la cuenta</p>
                        <p class="text-xs text-ink-500">Desactivar para bloquear acceso inmediato.</p>
                    </div>
                    <Button 
                        variant="secondary" 
                        class={user.is_active ? "hover:bg-red-50 hover:text-red-700" : "hover:bg-green-50 hover:text-green-700"}
                        onclick={toggleStatus}
                    >
                        {user.is_active ? "Desactivar Cuenta" : "Activar Cuenta"}
                    </Button>
                </div>

                <div class="flex items-center justify-between py-4">
                    <div>
                        <p class="font-bold text-ink-900">Contraseña</p>
                        <p class="text-xs text-ink-500">Forzar cambio de contraseña.</p>
                    </div>
                    <Button variant="secondary" onclick={resetPassword}>
                        Restablecer
                    </Button>
                </div>
            </div>

            <!-- Actions -->
            <div class="flex justify-end gap-3">
                <Button variant="secondary" onclick={() => goto("/dashboard/admin")}>Cancelar</Button>
                <Button onclick={saveChanges} disabled={saving}>
                    {saving ? "Guardando..." : "Guardar Cambios"}
                </Button>
            </div>
        </div>
    {/if}
</div>
