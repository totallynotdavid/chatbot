<script lang="ts">
import { goto } from "$app/navigation";
import type { Product } from "@totem/types";
import { toast } from "$lib/state/toast.svelte";
import { fetchApi } from "$lib/utils/api";
import { validateRequired, hasErrors, type ValidationErrors } from "$lib/utils/validation";
import Button from "$lib/components/ui/button.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import FormField from "$lib/components/ui/form-field.svelte";
import Input from "$lib/components/ui/input.svelte";
import Textarea from "$lib/components/ui/textarea.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();
let product: Product | null = $derived(data.product);

let formData = $state({
  name: "",
  category: "",
  brand: "",
  model: "",
  specs: "{}",
});

let errors = $state<ValidationErrors>({});
let isSaving = $state(false);

$effect(() => {
  if (product) {
    formData = {
      name: product.name,
      category: product.category,
      brand: product.brand || "",
      model: product.model || "",
      specs: product.specs_json || "{}",
    };
  } else {
    // defaults
  }
});

function validate(): boolean {
  const newErrors: ValidationErrors = {};

  const nameError = validateRequired(formData.name, "El nombre");
  if (nameError) newErrors.name = nameError;

  const categoryError = validateRequired(formData.category, "La categoría");
  if (categoryError) newErrors.category = categoryError;

  try {
    JSON.parse(formData.specs);
  } catch {
    newErrors.specs = "JSON inválido";
  }

  errors = newErrors;
  return !hasErrors(newErrors);
}

function goBack() {
    goto(`/dashboard/catalog`); 
}

async function handleSave() {
  if (!validate()) {
    toast.error("Por favor corrige los errores en el formulario");
    return;
  }

  isSaving = true;
  try {
    const payload = {
      name: formData.name.trim(),
      category: formData.category.trim(),
      brand: formData.brand.trim() || null,
      model: formData.model.trim() || null,
      specs_json: formData.specs,
    };

    if (!product) {
      // Create
      await fetchApi("/api/catalog/products", { 
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      toast.success("Producto base creado");
    } else {
       // Update
       await fetchApi(`/api/catalog/products/${product.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
       });
       toast.success("Producto base actualizado");
    }

    goBack();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Error al guardar");
  } finally {
    isSaving = false;
  }
}
</script>

<PageTitle title={product ? "Editar Producto Base" : "Nuevo Producto Base"} />

<div class="max-w-4xl mx-auto p-8 md:p-12">
    <div class="mb-8 flex items-center justify-between">
        <div>
            <h1 class="text-3xl font-serif text-ink-900">{product ? product.name : "Nuevo Producto Base"}</h1>
            <p class="text-ink-500 mt-2">Gestiona la información del producto base (plantilla).</p>
        </div>
        <Button variant="ghost" onclick={goBack}>Cancelar</Button>
    </div>

    <div class="bg-white rounded-lg shadow-sm border border-ink-900/10 p-8">
        <div class="space-y-6">
            <FormField label="Nombre del producto base*" for="name" error={errors.name}>
                <Input id="name" bind:value={formData.name} placeholder="Ej. Cocina Mabe 4 Hornillas" />
            </FormField>

            <div class="grid grid-cols-2 gap-8">
                <FormField label="Categoría*" for="category" error={errors.category}>
                    <Input id="category" bind:value={formData.category} placeholder="Ej. Cocinas" />
                </FormField>

                <FormField label="Marca" for="brand">
                    <Input id="brand" bind:value={formData.brand} placeholder="Ej. Mabe" />
                </FormField>
            </div>

            <FormField label="Modelo" for="model">
                <Input id="model" bind:value={formData.model} placeholder="Ej. EMP-4020" />
            </FormField>

            <FormField label="Especificaciones (JSON)" for="specs" error={errors.specs}>
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

        <div class="pt-6 border-t border-ink-900/10 flex justify-end gap-3 mt-6">
             <Button variant="secondary" onclick={goBack} disabled={isSaving}>Cancelar</Button>
             <Button onclick={handleSave} disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar"}</Button>
        </div>
    </div>
</div>
