<script lang="ts">
import FormField from "$lib/components/ui/form-field.svelte";
import Input from "$lib/components/ui/input.svelte";
import Select from "$lib/components/ui/select.svelte";
import Button from "$lib/components/ui/button.svelte";
import { toast } from "$lib/state/toast.svelte";
import { fetchApi } from "$lib/utils/api";
import { MIN_PASSWORD_LENGTH } from "@totem/types";
import { PASSWORD_TOO_SHORT_MESSAGE } from "$lib/utils/password";

type Props = {
  onSuccess: () => void;
};

let { onSuccess }: Props = $props();

let formData = $state({
  name: "",
  username: "",
  password: "",
  role: "sales_agent",
  phoneNumber: "",
});

let message = $state("");

async function handleSubmit() {
  if (!formData.name || !formData.username || !formData.password) {
    message = "Todos los campos son obligatorios";
    return;
  }

  if (formData.password.length < MIN_PASSWORD_LENGTH) {
    message = `Error: ${PASSWORD_TOO_SHORT_MESSAGE}`;
    return;
  }

  try {
    await fetchApi("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    });

    message = `Usuario ${formData.username} creado correctamente.`;
    toast.success(message);
    formData = {
      name: "",
      username: "",
      password: "",
      role: "sales_agent",
      phoneNumber: "",
    };
    onSuccess();
  } catch (error) {
    message = error instanceof Error ? error.message : "Error al crear usuario";
  }
}
</script>

<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-6">
	<FormField label="Nombre completo" for="name">
		<Input id="name" bind:value={formData.name} placeholder="Juan Pérez" />
	</FormField>

	<FormField label="Nombre de usuario" for="username">
		<Input id="username" bind:value={formData.username} placeholder="jperez" />
	</FormField>

	<FormField label="Contraseña temporal" for="password">
		<Input id="password" type="password" bind:value={formData.password} />
		<p class="text-xs text-ink-400 mt-1">Mínimo {MIN_PASSWORD_LENGTH} caracteres.</p>
	</FormField>

	<FormField label="Teléfono (WhatsApp)" for="phoneNumber">
		<Input 
			id="phoneNumber" 
			bind:value={formData.phoneNumber} 
			placeholder="+51987654321"
		/>
		<p class="text-xs text-ink-400 mt-1">Solo para agentes de ventas. Incluir código de país.</p>
	</FormField>

	<FormField label="Rol de acceso" for="role">
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

	{#if message}
		<div class="p-4 text-sm font-serif italic border {message.includes('Error') || message.includes('obligatorios') ? 'bg-red-50 text-red-800 border-red-200' : 'bg-green-50 text-green-800 border-green-200'}">
			{message}
		</div>
	{/if}

	<Button type="submit" class="w-full">Crear credenciales</Button>
</form>
