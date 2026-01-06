<script lang="ts">
import { goto } from "$app/navigation";
import type { FnbOffering, Product } from "@totem/types";
import { fetchApi, createFormData } from "$lib/utils/api";
import { toast } from "$lib/state/toast.svelte";
import ImageUploadSimple from "$lib/components/catalog/image-upload-simple.svelte";
import Button from "$lib/components/ui/button.svelte";
import FormField from "$lib/components/ui/form-field.svelte";
import Input from "$lib/components/ui/input.svelte";
import Select from "$lib/components/ui/select.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import { validateRequired, validatePositiveNumber, validateImage, hasErrors, type ValidationErrors } from "$lib/utils/validation";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

let baseProducts = $derived(data.baseProducts);
let offering: FnbOffering | null = $derived(data.offering);
let periodId = $derived(data.periodId);

let formData = $state({
    productId: "",
    price: "",
    category: "",
    installments: "0" 
});
let image = $state<File | null>(null);
let errors = $state<ValidationErrors>({});
let isSaving = $state(false);

let selectedProduct = $derived(baseProducts.find((p: Product) => p.id === formData.productId));

let productOptions = $derived(
    baseProducts.map((p: Product) => ({ value: p.id, label: p.name }))
);

$effect(() => {
    if (offering) {
        formData = {
            productId: offering.product_id,
            price: String(offering.price),
            category: offering.category,
            installments: offering.installments ? String(offering.installments) : "0"
        };
    }
});

$effect(() => {
    // Auto-fill category if product selected and category empty
    if (selectedProduct && !formData.category && !offering) {
        formData.category = selectedProduct.category;
    }
});

function validate() {
    const newErrors: ValidationErrors = {};
    
    if (!formData.productId) newErrors.productId = "Selecciona un producto";
    
    const priceError = validatePositiveNumber(formData.price, "El precio");
    if (priceError) newErrors.price = priceError;
    
    const catError = validateRequired(formData.category, "La categoría");
    if (catError) newErrors.category = catError;

    if (!offering) {
        const imgError = validateImage(image, true);
        if (imgError) newErrors.image = imgError;
    }

    errors = newErrors;
    return !hasErrors(newErrors);
}

function goBack() {
    const query = periodId ? `?period=${periodId}` : "";
    goto(`/dashboard/catalog${query}`);
}

async function handleSave() {
    if (!periodId && !offering) {
        toast.error("No se ha seleccionado un período");
        return;
    }

    if (!validate()) return;
    
    isSaving = true;
    try {
        const payloadRaw = {
            period_id: periodId,
            product_id: formData.productId,
            product_snapshot_json: JSON.stringify(selectedProduct),
            price: formData.price,
            category: formData.category,
            installments: formData.installments === "0" ? "" : formData.installments
        };

        if (offering) {
             await fetchApi(`/api/catalog/fnb/${offering.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    price: parseFloat(formData.price),
                    category: formData.category,
                    installments: formData.installments ? parseInt(formData.installments) : undefined
                })
             });
             if (image) {
                const imgForm = createFormData({ image });
                await fetchApi(`/api/catalog/fnb/${offering.id}/image`, { method: "POST", body: imgForm });
             }
             toast.success("Oferta actualizada");
        } else {
             const payload = createFormData({
                ...payloadRaw,
                image
             });
             await fetchApi("/api/catalog/fnb", { method: "POST", body: payload });
             toast.success("Oferta creada");
        }
        
        goBack();
    } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
        isSaving = false;
    }
}
</script>

<PageTitle title={offering ? "Editar Oferta FNB" : "Nueva Oferta FNB"} />

<div class="max-w-4xl mx-auto p-8 md:p-12">
    <div class="mb-8 flex items-center justify-between">
        <div>
            <h1 class="text-3xl font-serif text-ink-900">{offering ? "Editar Oferta FNB" : "Nueva Oferta FNB"}</h1>
            <p class="text-ink-500 mt-2">Configura el precio y condiciones para venta a crédito.</p>
        </div>
        <Button variant="ghost" onclick={goBack}>Cancelar</Button>
    </div>

    <div class="bg-white rounded-lg shadow-sm border border-ink-900/10 p-8 space-y-8">
        
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
             <div class="md:col-span-1">
                 <ImageUploadSimple 
                    hasExistingImage={!!offering} 
                    bind:image 
                    error={errors.image}
                    onImageChange={(f) => image = f} 
                />
            </div>
            
            <div class="md:col-span-2 space-y-6">
                <FormField label="Producto Base*" for="product" error={errors.productId}>
                    {#if offering}
                        <Input value={selectedProduct?.name || "Producto desconocido"} disabled />
                    {:else}
                         <Select 
                            value={formData.productId}
                            items={productOptions}
                            placeholder="Selecciona un producto..."
                            onchange={(e) => formData.productId = (e.currentTarget as any).value}
                        />
                    {/if}
                </FormField>

                <div class="grid grid-cols-2 gap-4">
                     <FormField label="Precio (S/)*" for="price" error={errors.price}>
                        <Input type="number" id="price" bind:value={formData.price} />
                    </FormField>
                    
                     <FormField label="Categoría*" for="category" error={errors.category}>
                        <Input id="category" bind:value={formData.category} />
                    </FormField>
                </div>

                 <FormField label="Cuotas (opcional)" for="installments">
                    <Input type="number" id="installments" bind:value={formData.installments} placeholder="Ej. 12" />
                    <p class="text-xs text-ink-500 mt-1">Si se deja vacío o 0, usa configuración por defecto.</p>
                </FormField>
            </div>
        </div>
        
        <div class="pt-6 border-t border-ink-900/10 flex justify-end gap-3">
             <Button variant="secondary" onclick={goBack} disabled={isSaving}>Cancelar</Button>
             <Button onclick={handleSave} disabled={isSaving}>{isSaving ? "Guardando..." : "Guardar Oferta"}</Button>
        </div>
    </div>
</div>
