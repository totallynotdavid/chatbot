<script lang="ts">
import { goto } from "$app/navigation";
import FormField from "$lib/components/ui/form-field.svelte";
import Input from "$lib/components/ui/input.svelte";
import Select from "$lib/components/ui/select.svelte";
import Button from "$lib/components/ui/button.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import PermissionMatrix from "$lib/components/admin/permission-matrix.svelte";
import { toast } from "$lib/state/toast.svelte";
import { fetchApi } from "$lib/utils/api";

let formData = $state({
  name: "",
  username: "",
  password: "",
  role: "sales_agent",
  phoneNumber: "",
});

let loading = $state(false);

async function handleSubmit() {
  if (!formData.name || !formData.username || !formData.password) {
    toast.error("Todos los campos marcados son obligatorios");
    return;
  }

  loading = true;
  try {
    await fetchApi("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });

    toast.success(`Usuario ${formData.username} creado correctamente`);
    goto("/dashboard/admin/users");
  } catch (error) {
    console.error(error);
    toast.error(
      "Error al crear usuario. Verifica que el nombre de usuario no exista.",
    );
  } finally {
    loading = false;
  }
}
</script>

<PageTitle title="Nuevo Usuario" />

<div class="max-w-3xl mx-auto p-8 md:p-12">
  <div class="mb-8">
    <h1 class="text-3xl font-serif text-ink-900">Registrar nuevo usuario</h1>
    <p class="text-ink-500 mt-2">Crea las credenciales de acceso iniciales para un nuevo miembro del equipo.</p>
  </div>

  <div class="bg-white border border-cream-200 shadow-sm p-8">
    <form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
             <FormField label="Nombre completo" for="name">
                <Input id="name" bind:value={formData.name} placeholder="Juan Pérez" />
            </FormField>
        
            <FormField label="Nombre de usuario" for="username">
                <Input id="username" bind:value={formData.username} placeholder="jperez" />
            </FormField>
        </div>

        <FormField label="Contraseña temporal" for="password">
            <Input id="password" type="password" bind:value={formData.password} />
            <p class="text-xs text-ink-400 mt-1">El usuario deberá cambiarla en su primer acceso.</p>
        </FormField>
    
        <div class="border-t border-cream-200 my-6 pt-6">
            <h3 class="text-lg font-serif mb-4">Configuración de acceso</h3>
            
            <FormField label="Rol de sistema" for="role">
                <Select
                    id="role"
                    bind:value={formData.role}
                    items={[
                        { value: "sales_agent", label: "Agente de ventas" },
                        { value: "supervisor", label: "Supervisor" },
                        { value: "developer", label: "Desarrollador" },
                        { value: "admin", label: "Administrador" },
                    ]}
                />
            </FormField>

            <PermissionMatrix role={formData.role} />
        </div>

        {#if formData.role === "sales_agent"}
             <div class="bg-blue-50 p-4 rounded border border-blue-100">
                <FormField label="Teléfono (WhatsApp)" for="phoneNumber">
                    <Input 
                        id="phoneNumber" 
                        bind:value={formData.phoneNumber} 
                        placeholder="+51987654321"
                    />
                    <p class="text-xs text-blue-700 mt-1">Requerido para la asignación automática de conversaciones.</p>
                </FormField>
             </div>
        {/if}
    
        <div class="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onclick={() => goto("/dashboard/admin/users")}>Cancelar</Button>
            <Button type="submit" disabled={loading}>
                {loading ? 'Creando...' : 'Crear Usuario'}
            </Button>
        </div>
    </form>
  </div>
</div>
