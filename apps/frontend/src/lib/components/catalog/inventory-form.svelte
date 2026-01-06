<script lang="ts">
import FormField from "$lib/components/ui/form-field.svelte";
import Input from "$lib/components/ui/input.svelte";
import Textarea from "$lib/components/ui/textarea.svelte";

type FormData = {
  name: string;
  category: string;
  brand: string;
  model: string;
  specs: string;
};

type Props = {
  formData: FormData;
  errors: Record<string, string>;
};

let { formData = $bindable(), errors }: Props = $props();
</script>

<div class="space-y-6">
  <FormField label="Nombre del producto base*" for="name" error={errors.name}>
    <Input
      id="name"
      bind:value={formData.name}
      error={!!errors.name}
      placeholder="Ej. Cocina Mabe 4 Hornillas"
    />
  </FormField>

  <div class="grid grid-cols-2 gap-8">
    <FormField label="Categoría*" for="category" error={errors.category}>
      <Input
        id="category"
        bind:value={formData.category}
        error={!!errors.category}
        placeholder="Ej. Cocinas"
      />
    </FormField>

    <FormField label="Marca" for="brand">
      <Input
        id="brand"
        bind:value={formData.brand}
        placeholder="Ej. Mabe"
      />
    </FormField>
  </div>

  <FormField label="Modelo" for="model">
    <Input
      id="model"
      bind:value={formData.model}
      placeholder="Ej. EMP-4020"
    />
  </FormField>

  <FormField label="Especificaciones (JSON)" for="specs">
    <Textarea
      id="specs"
      bind:value={formData.specs}
      placeholder='&#123;"color": "blanco", "quemadores": 4&#125;'
      class="font-mono text-xs"
    />
    <p class="text-xs text-ink-400 mt-1">
      Formato JSON válido requerido.
    </p>
  </FormField>
</div>
