<script lang="ts">
import FormField from "$lib/components/ui/form-field.svelte";
import Input from "$lib/components/ui/input.svelte";
import Select from "$lib/components/ui/select.svelte";
import Button from "$lib/components/ui/button.svelte";
import { toast } from "$lib/state/toast.svelte";
import { fetchApi } from "$lib/utils/api";

type Props = {
    onSuccess: () => void;
};

let { onSuccess }: Props = $props();

let formData = $state({
    name: "",
    username: "",
    password: "",
    role: "sales_agent",
});

let message = $state("");

async function handleSubmit() {
    if (!formData.name || !formData.username || !formData.password) {
        message = "Todos los campos son obligatorios";
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
        };
        onSuccess();
    } catch (error) {
        message =
            error instanceof Error ? error.message : "Error al crear usuario";
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
	</FormField>

	<FormField label="Rol de acceso" for="role">
		<Select
			id="role"
			bind:value={formData.role}
			items={[
				{ value: "sales_agent", label: "Agente de ventas" },
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
