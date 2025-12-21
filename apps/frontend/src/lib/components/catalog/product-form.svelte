<script lang="ts">
import type { Product, StockStatus, Segment } from "@totem/types";
import FormField from "$lib/components/ui/form-field.svelte";
import Input from "$lib/components/ui/input.svelte";
import Textarea from "$lib/components/ui/textarea.svelte";
import Select from "$lib/components/ui/select.svelte";
import Checkbox from "$lib/components/ui/checkbox.svelte";

type FormData = {
    name: string;
    description: string;
    price: string;
    installments: string;
    stockStatus: StockStatus;
    isActive: boolean;
    category: string;
    segment: Segment;
};

type Props = {
    product: Product | null;
    formData: FormData;
    errors: Record<string, string>;
};

let { product, formData = $bindable(), errors }: Props = $props();
</script>

<div class="space-y-6">
	<FormField label="Nombre del producto*" for="name" error={errors.name}>
		<Input
			id="name"
			bind:value={formData.name}
			error={!!errors.name}
			placeholder="Nombre del producto"
		/>
	</FormField>

	<div class="grid grid-cols-2 gap-8">
		<FormField label="Segmento*" for="segment">
			<Select
				id="segment"
				bind:value={formData.segment}
				items={[
					{ value: "fnb", label: "Financiera (FNB)" },
					{ value: "gaso", label: "Gasodomésticos" },
				]}
			/>
		</FormField>

		<FormField label="Categoría*" for="category" error={errors.category}>
			<Input
				id="category"
				bind:value={formData.category}
				error={!!errors.category}
				placeholder="Ej. Cocinas, Celulares"
			/>
		</FormField>
	</div>

	<div class="grid grid-cols-2 gap-8">
		<FormField label="Precio (S/)*" for="price" error={errors.price}>
			<Input
				id="price"
				type="number"
				bind:value={formData.price}
				error={!!errors.price}
				placeholder="0.00"
			/>
		</FormField>

		<FormField label="Cuotas" for="installments" error={errors.installments}>
			<Input
				id="installments"
				type="number"
				bind:value={formData.installments}
				error={!!errors.installments}
				placeholder="12"
			/>
		</FormField>
	</div>

	<FormField label="Estado de stock*" for="stock">
		<Select
			id="stock"
			bind:value={formData.stockStatus}
			items={[
				{ value: "in_stock", label: "En stock" },
				{ value: "low_stock", label: "Stock bajo" },
				{ value: "out_of_stock", label: "Agotado" },
			]}
		/>
	</FormField>

	<FormField label="Descripción" for="description">
		<Textarea
			id="description"
			bind:value={formData.description}
			placeholder="Especificaciones técnicas (opcional)"
		/>
	</FormField>

	<div class="flex items-center gap-3 pt-2">
		<Checkbox id="active" bind:checked={formData.isActive} />
		<label
			for="active"
			class="text-sm font-bold uppercase tracking-wide cursor-pointer"
		>
			Producto activo
		</label>
	</div>
</div>
