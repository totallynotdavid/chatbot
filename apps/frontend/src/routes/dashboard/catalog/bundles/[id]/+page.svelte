<script lang="ts">
    import { goto } from "$app/navigation";
    import type { Bundle, SnapshotProduct, Product } from "@totem/types";
    import Button from "$lib/components/ui/button.svelte";
    import ImageUploadSimple from "$lib/components/catalog/image-upload-simple.svelte";
    import FormField from "$lib/components/ui/form-field.svelte";
    import Input from "$lib/components/ui/input.svelte";
    import Select from "$lib/components/ui/select.svelte";
    import PageTitle from "$lib/components/shared/page-title.svelte";
    import { toast } from "$lib/state/toast.svelte";
    import { fetchApi, createFormData } from "$lib/utils/api";
    import {
        validateRequired,
        validatePositiveNumber,
        validateImage,
        hasErrors,
        type ValidationErrors,
    } from "$lib/utils/validation";
    import type { PageData } from "./$types";

    let { data }: { data: PageData } = $props();

    let baseProducts = $derived(data.baseProducts);
    let bundle: Bundle | null = $derived(data.bundle);
    let periodId = $derived(data.periodId);

    let formData = $state({
        name: "",
        price: "",
        primaryCategory: "",
    });

    let items = $state<string[]>([]); // Array of product IDs
    let installments = $state<Record<string, string>>({
        "3": "",
        "6": "",
        "9": "",
        "12": "",
        "18": "",
    });

    let image = $state<File | null>(null);
    let errors = $state<ValidationErrors>({});
    let isSaving = $state(false);

    const MONTH_OPTIONS = ["3", "6", "9", "12", "18"];

    let productOptions = $derived(
        baseProducts.map((p: Product) => ({ value: p.id, label: p.name })),
    );

    $effect(() => {
        if (bundle) {
            formData = {
                name: bundle.name,
                price: String(bundle.price),
                primaryCategory: bundle.primary_category,
            };
            try {
                const comp = JSON.parse(bundle.composition_json);
                if (comp.fixed) {
                    items = comp.fixed.map((p: SnapshotProduct) => p.id);
                }
                const sched = JSON.parse(bundle.installments_json);
                const newInst: Record<string, string> = {
                    "3": "",
                    "6": "",
                    "9": "",
                    "12": "",
                    "18": "",
                };
                if (Array.isArray(sched)) {
                    sched.forEach((s: any) => {
                        if (MONTH_OPTIONS.includes(String(s.months))) {
                            newInst[String(s.months)] = String(s.monthlyAmount);
                        }
                    });
                }
                installments = newInst;
            } catch {
                items = [];
            }
        } else if (items.length === 0) {
            // Initialize with one empty item slot if new
            items = [""];
        }
    });

    function addItem() {
        items = [...items, ""];
    }

    function updateItem(index: number, productId: string) {
        const newItems = [...items];
        newItems[index] = productId;
        items = newItems;
    }

    function removeItem(index: number) {
        const newItems = [...items];
        newItems.splice(index, 1);
        items = newItems;
    }

    function validate(): boolean {
        const newErrors: ValidationErrors = {};

        const nameError = validateRequired(formData.name, "El nombre");
        if (nameError) newErrors.name = nameError;

        const priceError = validatePositiveNumber(formData.price, "El precio");
        if (priceError) newErrors.price = priceError;

        const catError = validateRequired(
            formData.primaryCategory,
            "La categoría",
        );
        if (catError) newErrors.primaryCategory = catError;

        if (items.filter((id) => !!id).length === 0) {
            newErrors.items = "Agrega al menos un producto";
        }

        if (!bundle) {
            const imageError = validateImage(image, true);
            if (imageError) newErrors.image = imageError;
        }

        errors = newErrors;
        return !hasErrors(newErrors);
    }

    function goBack() {
        // Preserve period selection
        const query = periodId ? `?period=${periodId}` : "";
        // After redirect, would be nice to activate the relevant tab via URL param
        // The +page.svelte defaults to inventory or keeps state if persistent.
        // We should probably add tab param support to catalog/+page.svelte later.
        goto(`/dashboard/catalog${query}`);
    }

    async function handleSave() {
        if (!periodId && !bundle) {
            toast.error("No se ha seleccionado un período");
            return;
        }

        if (!validate()) return;

        isSaving = true;
        try {
            const selectedProducts = items
                .filter((id) => !!id)
                .map((id) => baseProducts.find((p: Product) => p.id === id))
                .filter((p) => !!p);

            const composition = {
                fixed: selectedProducts.map((p) => ({
                    id: p!.id,
                    name: p!.name,
                    specs: JSON.parse(p!.specs_json || "{}"),
                })),
                choices: [],
            };

            const schedule = MONTH_OPTIONS.filter(
                (m) => installments[m] && parseFloat(installments[m]) > 0,
            ).map((m) => {
                const amount = installments[m] || "0";
                return {
                    months: parseInt(m, 10),
                    monthlyAmount: parseFloat(amount),
                    totalAmount: parseFloat(amount) * parseInt(m, 10),
                };
            });

            const payloadRaw = {
                period_id: periodId,
                name: formData.name,
                price: formData.price,
                primary_category: formData.primaryCategory,
                categories_json: "[]",
                composition_json: JSON.stringify(composition),
                installments_json: JSON.stringify(schedule),
            };

            // Create Mode
            if (!bundle) {
                const payload = createFormData({
                    ...payloadRaw,
                    image,
                });
                await fetchApi("/api/catalog/bundles", {
                    method: "POST",
                    body: payload,
                });
                toast.success("Paquete creado con éxito");
            }
            // Edit Mode
            else {
                await fetchApi(`/api/catalog/bundles/${bundle.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: formData.name,
                        price: parseFloat(formData.price),
                        primary_category: formData.primaryCategory,
                        composition_json: JSON.stringify(composition),
                        installments_json: JSON.stringify(schedule),
                    }),
                });
                if (image) {
                    const imgForm = createFormData({ image });
                    await fetchApi(`/api/catalog/bundles/${bundle.id}/image`, {
                        method: "POST",
                        body: imgForm,
                    });
                }
                toast.success("Paquete actualizado");
            }

            goBack();
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Error al guardar",
            );
        } finally {
            isSaving = false;
        }
    }
</script>

<PageTitle title={bundle ? "Editar bundle" : "Nuevo bundle"} />

<div class="max-w-4xl mx-auto p-8 md:p-12">
    <div class="mb-8 flex items-center justify-between">
        <div>
            <h1 class="text-3xl font-serif text-ink-900">
                {bundle ? "Editar bundle GASO" : "Nuevo bundle GASO"}
            </h1>
            <p class="text-ink-500 mt-2">
                Configura la composición, precios y cuotas del paquete.
            </p>
        </div>
        <Button variant="ghost" onclick={goBack}>Cancelar</Button>
    </div>

    <div
        class="bg-white rounded-lg shadow-sm border border-ink-900/10 p-8 space-y-8"
    >
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div class="md:col-span-1">
                <ImageUploadSimple
                    hasExistingImage={!!bundle}
                    bind:image
                    error={errors.image}
                    onImageChange={(f) => (image = f)}
                />
            </div>

            <div class="md:col-span-2 space-y-6">
                <FormField
                    label="Nombre Comercial*"
                    for="name"
                    error={errors.name}
                >
                    <Input
                        id="name"
                        bind:value={formData.name}
                        placeholder="Ej. Combo Cocina + Licuadora"
                    />
                </FormField>

                <div class="grid grid-cols-2 gap-4">
                    <FormField
                        label="Precio Contado (S/)*"
                        for="price"
                        error={errors.price}
                    >
                        <Input
                            type="number"
                            id="price"
                            bind:value={formData.price}
                        />
                    </FormField>

                    <FormField
                        label="Categoría Principal*"
                        for="category"
                        error={errors.primaryCategory}
                    >
                        <Input
                            id="category"
                            bind:value={formData.primaryCategory}
                            placeholder="Ej. Cocinas"
                        />
                    </FormField>
                </div>
            </div>
        </div>

        <!-- Composition Section -->
        <div class="border-t border-ink-100 pt-6">
            <h4 class="text-lg font-bold text-ink-900 mb-4">
                Composición del Paquete
            </h4>
            <p class="text-sm text-ink-500 mb-4">
                Selecciona los productos base que componen este paquete. Se
                pueden agregar productos fijos.
            </p>

            {#if errors.items}
                <p class="text-xs text-red-600 mb-2">{errors.items}</p>
            {/if}

            <div class="space-y-3 bg-gray-50 p-4 rounded-md">
                {#each items as itemId, i}
                    <div class="flex gap-2 items-center">
                        <span
                            class="text-sm font-medium w-8 text-center text-ink-400"
                            >{i + 1}.</span
                        >
                        <div class="flex-1">
                            <Select
                                value={itemId}
                                items={productOptions}
                                placeholder="Seleccionar producto..."
                                onchange={(e) =>
                                    updateItem(
                                        i,
                                        (e.currentTarget as any).value,
                                    )}
                            />
                        </div>
                        <Button
                            variant="ghost"
                            onclick={() => removeItem(i)}
                            class="px-2 text-red-600 hover:bg-red-50">×</Button
                        >
                    </div>
                {/each}
                <Button
                    variant="outline"
                    onclick={addItem}
                    class="w-full text-sm mt-2 border-dashed"
                    >+ Agregar producto al paquete</Button
                >
            </div>
        </div>

        <!-- Installments Section -->
        <div class="border-t border-ink-100 pt-6">
            <h4 class="text-lg font-bold text-ink-900 mb-4">
                Cuotas mensuales (GASO)
            </h4>
            <p class="text-sm text-ink-500 mb-4">
                Define el valor de la cuota mensual para cada plazo disponible.
            </p>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                {#each MONTH_OPTIONS as months}
                    <FormField label={`${months} meses`}>
                        <Input
                            type="number"
                            bind:value={installments[months]}
                            placeholder="S/"
                            class="text-right"
                        />
                    </FormField>
                {/each}
            </div>
        </div>

        <div class="pt-6 border-t border-ink-900/10 flex justify-end gap-3">
            <Button variant="secondary" onclick={goBack} disabled={isSaving}
                >Cancelar</Button
            >
            <Button onclick={handleSave} disabled={isSaving}
                >{isSaving ? "Guardando..." : "Guardar Paquete"}</Button
            >
        </div>
    </div>
</div>
