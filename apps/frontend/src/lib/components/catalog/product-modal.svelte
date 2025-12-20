<script lang="ts">
import type { Product, StockStatus, Segment } from "@totem/types";
import Modal from "$lib/components/ui/modal.svelte";
import Button from "$lib/components/ui/button.svelte";
import ImageUploadSection from "./image-upload-section.svelte";
import ProductForm from "./product-form.svelte";
import { toast } from "$lib/state/toast.svelte";
import { fetchApi, createFormData } from "$lib/utils/api";
import {
    validateRequired,
    validatePositiveNumber,
    validateImage,
    hasErrors,
    type ValidationErrors,
} from "$lib/utils/validation";

type Props = {
    product: Product | null;
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
};

let { product, open, onClose, onSuccess }: Props = $props();

let formData = $state({
    name: "",
    description: "",
    price: "",
    installments: "",
    stockStatus: "in_stock" as StockStatus,
    isActive: true,
    category: "",
    segment: "fnb" as Segment,
});

let mainImage = $state<File | null>(null);
let specsImage = $state<File | null>(null);
let errors = $state<ValidationErrors>({});
let isSaving = $state(false);
let isExtracting = $state(false);

$effect(() => {
    if (product) {
        formData = {
            name: product.name,
            description: product.description || "",
            price: String(product.price),
            installments: product.installments
                ? String(product.installments)
                : "",
            stockStatus: product.stock_status,
            isActive: product.is_active === 1,
            category: product.category,
            segment: product.segment,
        };
        mainImage = null;
        specsImage = null;
    } else {
        formData = {
            name: "",
            description: "",
            price: "",
            installments: "",
            stockStatus: "in_stock",
            isActive: true,
            category: "",
            segment: "fnb",
        };
        mainImage = null;
        specsImage = null;
    }
    errors = {};
});

function validate(): boolean {
    const newErrors: ValidationErrors = {};

    const nameError = validateRequired(formData.name, "El nombre");
    if (nameError) newErrors.name = nameError;

    const categoryError = validateRequired(formData.category, "La categoría");
    if (categoryError) newErrors.category = categoryError;

    const priceError = validatePositiveNumber(formData.price, "El precio");
    if (priceError) newErrors.price = priceError;

    if (formData.installments) {
        const installmentsNum = parseInt(formData.installments, 10);
        if (Number.isNaN(installmentsNum) || installmentsNum <= 0) {
            newErrors.installments = "Las cuotas deben ser un número válido";
        }
    }

    if (!product) {
        const imageError = validateImage(mainImage, true);
        if (imageError) newErrors.mainImage = imageError;
    }

    errors = newErrors;
    return !hasErrors(newErrors);
}

async function extractData() {
    if (!mainImage) return;

    isExtracting = true;
    try {
        const form = createFormData({ mainImage, specsImage });
        const data = await fetchApi<any>("/api/catalog/extract-preview", {
            method: "POST",
            body: form,
        });

        if (data.name) formData.name = data.name;
        if (data.price) formData.price = String(data.price);
        if (data.installments)
            formData.installments = String(data.installments);
        if (data.category) formData.category = data.category;
        if (data.description) formData.description = data.description;

        toast.success("Datos extraídos correctamente");
    } catch {
        toast.error("No se pudo extraer los datos");
    } finally {
        isExtracting = false;
    }
}

async function handleSave() {
    if (!validate()) {
        toast.error("Por favor corrige los errores en el formulario");
        return;
    }

    isSaving = true;
    try {
        if (!product) {
            const form = createFormData({
                image: mainImage,
                specsImage,
                name: formData.name.trim(),
                price: formData.price,
                segment: formData.segment,
                category: formData.category.trim(),
                description: formData.description.trim() || null,
                installments: formData.installments || null,
            });

            await fetchApi("/api/catalog", { method: "POST", body: form });
            toast.success("Producto creado correctamente");
        } else {
            if (mainImage || specsImage) {
                const form = createFormData({
                    mainImage,
                    specsImage,
                    productId: product.id,
                });
                await fetchApi(`/api/catalog/${product.id}/images`, {
                    method: "POST",
                    body: form,
                });
            }

            await fetchApi(`/api/catalog/${product.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: formData.name.trim(),
                    description: formData.description.trim() || null,
                    price: parseFloat(formData.price),
                    installments: formData.installments
                        ? parseInt(formData.installments, 10)
                        : null,
                    stock_status: formData.stockStatus,
                    is_active: formData.isActive ? 1 : 0,
                    category: formData.category.trim(),
                    segment: formData.segment,
                }),
            });
            toast.success("Producto actualizado correctamente");
        }

        onSuccess();
        onClose();
    } catch (error) {
        toast.error(
            error instanceof Error ? error.message : "Error al guardar",
        );
    } finally {
        isSaving = false;
    }
}
</script>

<Modal
	{open}
	{onClose}
	title={product ? product.name : "Nuevo producto"}
	subtitle={product ? "Editar producto" : "Crear producto"}
>
	<ImageUploadSection
		{product}
		bind:mainImage
		bind:specsImage
		mainImageError={errors.mainImage}
		{isExtracting}
		onMainImageChange={(file) => mainImage = file}
		onSpecsImageChange={(file) => specsImage = file}
		onExtract={extractData}
	/>

	<ProductForm {product} bind:formData {errors} />

	{#snippet footer()}
		<Button variant="secondary" onclick={onClose} disabled={isSaving}>
			Cancelar
		</Button>
		<Button onclick={handleSave} disabled={isSaving}>
			{isSaving ? "Guardando..." : product ? "Guardar cambios" : "Crear producto"}
		</Button>
	{/snippet}
</Modal>
