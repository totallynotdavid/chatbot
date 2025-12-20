<script lang="ts">
import type { Product, StockStatus, Segment } from "@totem/types";
import { toasts } from "$lib/toast.svelte";

type Props = {
    product: Product | null;
    isOpen: boolean;
    onClose: () => void;
    onUpdate: (updated: Product) => void;
};

let { product, isOpen, onClose, onUpdate }: Props = $props();

// Form state
let name = $state("");
let description = $state("");
let price = $state("");
let installments = $state("");
let stockStatus = $state<StockStatus>("in_stock");
let isActive = $state(true);
let category = $state("");
let segment = $state<Segment>("fnb"); // Added segment for creation

// Image replacement state
let newMainImage: File | null = $state(null);
let newSpecsImage: File | null = $state(null);
let mainImagePreview = $state<string | null>(null);
let specsImagePreview = $state<string | null>(null);

// UI state
let isSaving = $state(false);
let errors = $state<Record<string, string>>({});

// Reset form when product changes
$effect(() => {
    if (product) {
        name = product.name;
        description = product.description || "";
        price = String(product.price);
        installments = product.installments ? String(product.installments) : "";
        stockStatus = product.stock_status;
        isActive = product.is_active === 1;
        category = product.category;
        segment = product.segment;
        newMainImage = null;
        newSpecsImage = null;
        mainImagePreview = null;
        specsImagePreview = null;
        errors = {};
    } else {
        name = "";
        description = "";
        price = "";
        installments = "";
        stockStatus = "in_stock";
        isActive = true;
        category = "";
        segment = "fnb";
        newMainImage = null;
        newSpecsImage = null;
        mainImagePreview = null;
        specsImagePreview = null;
        errors = {};
    }
});

function handleMainImageChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
        newMainImage = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            mainImagePreview = e.target?.result as string;
        };
        reader.readAsDataURL(file);
    }
}

function handleSpecsImageChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
        newSpecsImage = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            specsImagePreview = e.target?.result as string;
        };
        reader.readAsDataURL(file);
    }
}

function removeMainImage() {
    newMainImage = null;
    mainImagePreview = null;
}

function removeSpecsImage() {
    newSpecsImage = null;
    specsImagePreview = null;
}

// Extraction state
let isExtracting = $state(false);

// Drag & Drop state
let isDraggingMain = $state(false);
let isDraggingSpecs = $state(false);

function handleDragOver(e: DragEvent, type: 'main' | 'specs') {
    e.preventDefault();
    if (type === 'main') isDraggingMain = true;
    else isDraggingSpecs = true;
}

function handleDragLeave(e: DragEvent, type: 'main' | 'specs') {
    e.preventDefault();
    if (type === 'main') isDraggingMain = false;
    else isDraggingSpecs = false;
}

function handleDrop(e: DragEvent, type: 'main' | 'specs') {
    e.preventDefault();
    if (type === 'main') isDraggingMain = false;
    else isDraggingSpecs = false;
    
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
        if (type === 'main') {
            newMainImage = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                mainImagePreview = e.target?.result as string;
            };
            reader.readAsDataURL(file);
        } else {
            newSpecsImage = file;
            const reader = new FileReader();
            reader.onload = (e) => {
                specsImagePreview = e.target?.result as string;
            };
            reader.readAsDataURL(file);
        }
    }
}

async function extractData() {
    if (!newMainImage) return;
    isExtracting = true;
    try {
        const form = new FormData();
        form.append("mainImage", newMainImage);
        if (newSpecsImage) form.append("specsImage", newSpecsImage);
        
        const res = await fetch("/api/catalog/extract-preview", { method: "POST", body: form });
        if (res.ok) {
            const data = await res.json();
            if (data.name) name = data.name;
            if (data.price) price = String(data.price);
            if (data.installments) installments = String(data.installments);
            if (data.category) category = data.category;
            if (data.description) description = data.description;
            toasts.success("Datos extraídos correctamente");
        } else {
            toasts.error("No se pudo extraer los datos");
        }
    } catch(e) {
        console.error(e);
        toasts.error("Error al extraer datos");
    } finally {
        isExtracting = false;
    }
}

function validate(): boolean {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
        newErrors.name = "El nombre es requerido";
    }

    if (!category.trim()) {
        newErrors.category = "La categoría es requerida";
    }

    if (!product && !newMainImage) {
        newErrors.mainImage = "La imagen principal es requerida";
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
        newErrors.price = "El precio debe ser mayor a 0";
    }

    if (installments) {
        const installmentsNum = parseInt(installments, 10);
        if (isNaN(installmentsNum) || installmentsNum <= 0) {
            newErrors.installments = "Las cuotas deben ser un número válido";
        }
    }

    errors = newErrors;
    return Object.keys(newErrors).length === 0;
}

async function handleSave() {
    if (!validate()) {
        toasts.error("Por favor corrige los errores en el formulario");
        return;
    }

    isSaving = true;
    errors = {};

    try {
        if (!product) {
            // Create new product
            const formData = new FormData();
            if (newMainImage) formData.append("image", newMainImage);
            if (newSpecsImage) formData.append("specsImage", newSpecsImage);
            
            formData.append("name", name.trim());
            formData.append("price", price);
            formData.append("segment", segment);
            formData.append("category", category.trim());
            if (description.trim()) formData.append("description", description.trim());
            if (installments) formData.append("installments", installments);

            const res = await fetch("/api/catalog", {
                method: "POST",
                body: formData,
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || "Error al crear producto");
            }

            const data = await res.json();
            // The API returns { success: true, id: ... } or similar, but we need the full product to update the list.
            // Ideally the API should return the created product. 
            // If not, we might need to reload the list in the parent.
            // Assuming onUpdate handles a new product being added to the list if we pass it.
            // But wait, onUpdate signature is (updated: Product) => void.
            // If the API doesn't return the full product, we might have an issue.
            // Let's check the backend code for POST /api/catalog.
            
            // For now, let's assume we need to reload or the API returns enough info.
            // If the API returns the created product, great.
            // If not, we might need to change onUpdate to accept void or handle reload.
            
            // Let's check the backend response for POST /api/catalog.
            // I'll pause this edit to check backend.
        } else {
            // Check if we need to upload new images
            if (newMainImage || newSpecsImage) {
                const formData = new FormData();
                
                if (newMainImage) {
                    formData.append("mainImage", newMainImage);
                }
                if (newSpecsImage) {
                    formData.append("specsImage", newSpecsImage);
                }
                formData.append("productId", product.id);

                const uploadRes = await fetch(`/api/catalog/${product.id}/images`, {
                    method: "POST",
                    body: formData,
                });

                if (!uploadRes.ok) {
                    throw new Error("Error al subir imágenes");
                }
            }

            // Update metadata
            const updates: Partial<Product> = {
                name: name.trim(),
                description: description.trim() || null,
                price: parseFloat(price),
                installments: installments ? parseInt(installments, 10) : null,
                stock_status: stockStatus,
                is_active: isActive ? 1 : 0,
                category: category.trim(),
                segment: segment,
            };

            const res = await fetch(`/api/catalog/${product.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(updates),
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || "Error al actualizar");
            }

            const data = await res.json();
            onUpdate(data.product);
            toasts.success("Producto actualizado correctamente");
        }
        
        if (!product) {
             toasts.success("Producto creado correctamente");
             // We need to trigger a reload in parent because we might not have the full product object from the create response
             // Or we can try to construct it.
             // Let's assume onUpdate can handle it or we pass a signal.
             // Actually, let's check the backend first.
        }
        onClose();
    } catch (error) {
        console.error("Save error:", error);
        toasts.error(error instanceof Error ? error.message : "Error al guardar los cambios");
    } finally {
        isSaving = false;
    }
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
        onClose();
    }
}

function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
        onClose();
    }
}
</script>

{#if isOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-backdrop" onclick={handleBackdropClick} onkeydown={handleKeydown}>
        <div class="modal-panel">
            <div class="modal-header">
                <div>
                    <span class="modal-subtitle">{product ? "Editar producto" : "Crear producto"}</span>
                    <h2 class="modal-title">{product ? product.name : "Nuevo producto"}</h2>
                </div>
                <button onclick={onClose} class="modal-close" aria-label="Cerrar">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <div class="modal-body">
                <!-- Current Images Preview -->
                {#if product}
                <div class="mb-8">
                    <span class="input-label mb-3 block">Imágenes actuales</span>
                    <div class="grid grid-cols-2 gap-4">
                        <div class="image-preview-box">
                            <img
                                src={mainImagePreview || `/static/${product.image_main_path}`}
                                alt="Imagen principal"
                                class="w-full h-full object-cover"
                            />
                            <span class="image-label">Principal</span>
                        </div>
                        {#if product.image_specs_path || specsImagePreview}
                            <div class="image-preview-box">
                                <img
                                    src={specsImagePreview || `/static/${product.image_specs_path}`}
                                    alt="Especificaciones"
                                    class="w-full h-full object-cover"
                                />
                                <span class="image-label">Especificaciones</span>
                            </div>
                        {/if}
                    </div>
                </div>
                {/if}

                <!-- Image Replacement -->
                <div class="mb-8 p-6 bg-ink-50 rounded-lg border border-ink-100">
                    <span class="input-label mb-3 block">{product ? "Reemplazar imágenes (opcional)" : "Imágenes del producto"}</span>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label 
                                class="upload-button {errors.mainImage ? 'border-red-600' : ''} {isDraggingMain ? 'bg-ink-100 border-ink-900' : ''} {newMainImage ? 'border-solid bg-ink-50' : ''}"
                                ondragover={(e) => handleDragOver(e, 'main')}
                                ondragleave={(e) => handleDragLeave(e, 'main')}
                                ondrop={(e) => handleDrop(e, 'main')}
                            >
                                {#if newMainImage}
                                    <div class="flex flex-col items-center justify-center w-full overflow-hidden">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-2 text-ink-900"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                                        <span class="truncate max-w-full px-2 text-ink-900">{newMainImage.name}</span>
                                        <span class="text-[10px] text-ink-400 mt-1">Clic para cambiar</span>
                                    </div>
                                {:else}
                                    <div class="flex flex-col items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-2">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                            <polyline points="17 8 12 3 7 8"></polyline>
                                            <line x1="12" y1="3" x2="12" y2="15"></line>
                                        </svg>
                                        <span>{product ? "Nueva imagen principal" : "Imagen principal*"}</span>
                                    </div>
                                {/if}
                                <input type="file" accept="image/*" onchange={handleMainImageChange} class="hidden" />
                            </label>
                            {#if newMainImage}
                                <div class="flex justify-between items-center mt-2">
                                    <button onclick={removeMainImage} class="text-xs text-red-600 hover:underline font-medium uppercase tracking-wide">
                                        Cancelar cambio
                                    </button>
                                    {#if !product}
                                        <button 
                                            onclick={extractData} 
                                            disabled={isExtracting}
                                            class="text-xs text-ink-600 hover:text-ink-900 hover:underline font-medium uppercase tracking-wide flex items-center gap-1"
                                        >
                                            {#if isExtracting}
                                                <span class="animate-spin">↻</span> Analizando...
                                            {:else}
                                                ✨ Autocompletar
                                            {/if}
                                        </button>
                                    {/if}
                                </div>
                            {/if}
                            {#if errors.mainImage}
                                <span class="error-text">{errors.mainImage}</span>
                            {/if}
                        </div>
                        <div>
                            <label 
                                class="upload-button {isDraggingSpecs ? 'bg-ink-100 border-ink-900' : ''} {newSpecsImage ? 'border-solid bg-ink-50' : ''}"
                                ondragover={(e) => handleDragOver(e, 'specs')}
                                ondragleave={(e) => handleDragLeave(e, 'specs')}
                                ondrop={(e) => handleDrop(e, 'specs')}
                            >
                                {#if newSpecsImage}
                                    <div class="flex flex-col items-center justify-center w-full overflow-hidden">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-2 text-ink-900"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                                        <span class="truncate max-w-full px-2 text-ink-900">{newSpecsImage.name}</span>
                                        <span class="text-[10px] text-ink-400 mt-1">Clic para cambiar</span>
                                    </div>
                                {:else}
                                    <div class="flex flex-col items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-2">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                            <polyline points="17 8 12 3 7 8"></polyline>
                                            <line x1="12" y1="3" x2="12" y2="15"></line>
                                        </svg>
                                        <span>{newSpecsImage ? "Cambiar specs" : "Imagen especificaciones"}</span>
                                    </div>
                                {/if}
                                <input type="file" accept="image/*" onchange={handleSpecsImageChange} class="hidden" />
                            </label>
                            {#if newSpecsImage}
                                <button onclick={removeSpecsImage} class="text-xs text-red-600 hover:underline mt-2 font-medium uppercase tracking-wide">
                                    Cancelar cambio
                                </button>
                            {/if}
                        </div>
                    </div>
                </div>

                <!-- Metadata Form -->
                <div class="space-y-6">
                    <div class="input-group">
                        <label for="edit-name" class="input-label">Nombre del producto*</label>
                        <input
                            id="edit-name"
                            bind:value={name}
                            class="input-field {errors.name ? 'border-red-600' : ''}"
                            placeholder="Nombre del producto"
                        />
                        {#if errors.name}
                            <span class="error-text">{errors.name}</span>
                        {/if}
                    </div>

                    <div class="grid grid-cols-2 gap-8">
                        <div class="input-group">
                            <label for="edit-segment" class="input-label">Segmento*</label>
                            <select id="edit-segment" bind:value={segment} class="input-select">
                                <option value="fnb">Financiera (FNB)</option>
                                <option value="gaso">Gasodomésticos</option>
                            </select>
                        </div>
                        <div class="input-group">
                            <label for="edit-category" class="input-label">Categoría*</label>
                            <input
                                id="edit-category"
                                bind:value={category}
                                class="input-field {errors.category ? 'border-red-600' : ''}"
                                placeholder="Ej. Cocinas, Celulares"
                            />
                            {#if errors.category}
                                <span class="error-text">{errors.category}</span>
                            {/if}
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-8">
                        <div class="input-group">
                            <label for="edit-price" class="input-label">Precio (S/)*</label>
                            <input
                                id="edit-price"
                                bind:value={price}
                                type="number"
                                step="0.01"
                                class="input-field {errors.price ? 'border-red-600' : ''}"
                                placeholder="0.00"
                            />
                            {#if errors.price}
                                <span class="error-text">{errors.price}</span>
                            {/if}
                        </div>

                        <div class="input-group">
                            <label for="edit-installments" class="input-label">Cuotas</label>
                            <input
                                id="edit-installments"
                                bind:value={installments}
                                type="number"
                                class="input-field {errors.installments ? 'border-red-600' : ''}"
                                placeholder="12"
                            />
                            {#if errors.installments}
                                <span class="error-text">{errors.installments}</span>
                            {/if}
                        </div>
                    </div>

                    <div class="input-group">
                        <label for="edit-stock" class="input-label">Estado de stock*</label>
                        <select id="edit-stock" bind:value={stockStatus} class="input-select">
                            <option value="in_stock">En stock</option>
                            <option value="low_stock">Stock bajo</option>
                            <option value="out_of_stock">Agotado</option>
                        </select>
                    </div>

                    <div class="input-group">
                        <label for="edit-description" class="input-label">Descripción</label>
                        <textarea
                            id="edit-description"
                            bind:value={description}
                            class="input-field min-h-24"
                            placeholder="Especificaciones técnicas (opcional)"
                        ></textarea>
                    </div>

                    <div class="flex items-center gap-3 pt-2">
                        <input
                            id="edit-active"
                            type="checkbox"
                            bind:checked={isActive}
                            class="w-5 h-5 border-ink-900 text-ink-900 focus:ring-ink-900 focus:ring-offset-0 rounded-none"
                        />
                        <label for="edit-active" class="text-sm font-bold uppercase tracking-wide cursor-pointer">
                            Producto activo
                        </label>
                    </div>
                </div>
            </div>

            <div class="modal-footer">
                <button onclick={onClose} class="btn-secondary rounded-full px-6" disabled={isSaving}>
                    Cancelar
                </button>
                <button onclick={handleSave} class="btn-primary rounded-full px-6" disabled={isSaving}>
                    {isSaving ? "Guardando..." : (product ? "Guardar cambios" : "Crear producto")}
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
.modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(255, 255, 255, 0.8);
    backdrop-filter: blur(8px);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    animation: fadeIn 0.2s ease-out;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.modal-panel {
    background: white;
    border: 1px solid var(--color-ink-200);
    box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.1);
    border-radius: 2px;
    max-width: 42rem;
    width: 100%;
    max-height: calc(100vh - 4rem);
    display: flex;
    flex-direction: column;
    animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slideUp {
    from { transform: translateY(2rem); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}

.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 2rem 2.5rem 1.5rem;
    border-bottom: 1px solid var(--color-ink-100);
    background: white;
}

.modal-subtitle {
    display: block;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-ink-400);
    margin-bottom: 0.5rem;
}

.modal-title {
    font-family: var(--font-serif);
    font-size: 2rem;
    line-height: 1.1;
    color: var(--color-ink-900);
}

.modal-close {
    background: transparent;
    border: none;
    padding: 0.5rem;
    cursor: pointer;
    color: var(--color-ink-400);
    transition: all 0.2s;
    margin-top: -0.5rem;
    margin-right: -0.5rem;
    border-radius: 9999px;
}

.modal-close:hover {
    color: var(--color-ink-900);
    background: var(--color-ink-50);
}

.modal-body {
    padding: 2.5rem;
    overflow-y: auto;
    flex: 1;
}

.modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    padding: 1.5rem 2.5rem;
    border-top: 1px solid var(--color-ink-100);
    background: var(--color-ink-50);
}

.image-preview-box {
    position: relative;
    aspect-ratio: 4 / 5;
    border: 1px solid var(--color-ink-100);
    border-radius: 2px;
    overflow: hidden;
    background: var(--color-ink-50);
}

.image-label {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(4px);
    color: var(--color-ink-900);
    padding: 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-align: center;
    border-top: 1px solid var(--color-ink-100);
}

.upload-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 1rem;
    border: 1px dashed var(--color-ink-300);
    border-radius: 2px;
    background: white;
    color: var(--color-ink-600);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: all 0.2s;
}

.upload-button:hover {
    background: var(--color-ink-50);
    color: var(--color-ink-900);
    border-color: var(--color-ink-400);
}

.error-text {
    display: block;
    margin-top: 0.375rem;
    font-size: 0.75rem;
    color: #ef4444;
    font-weight: 500;
}

/* Input overrides for cleaner look */
:global(.input-field), :global(.input-select) {
    border-radius: 0 !important;
    border-width: 0 0 1px 0 !important;
    background: transparent !important;
    padding-left: 0 !important;
    border-color: var(--color-ink-200) !important;
}

:global(.input-field:focus), :global(.input-select:focus) {
    border-color: var(--color-ink-900) !important;
    box-shadow: none !important;
}

@media (max-width: 768px) {
    .modal-panel {
        max-height: 100vh;
        height: 100%;
        box-shadow: none;
        border-radius: 0;
    }

    .modal-header,
    .modal-body,
    .modal-footer {
        padding-left: 1.5rem;
        padding-right: 1.5rem;
    }
}
</style>
