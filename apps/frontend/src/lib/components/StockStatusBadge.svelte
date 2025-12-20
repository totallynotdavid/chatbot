<script lang="ts">
import type { StockStatus } from "@totem/types";
import { toasts } from "$lib/toast.svelte";

type Props = {
    productId: string;
    productName: string;
    stockStatus: StockStatus;
    canEdit: boolean;
    onUpdate: (newStatus: StockStatus) => void;
};

let { productId, productName, stockStatus, canEdit, onUpdate }: Props = $props();

let showDropdown = $state(false);
let isUpdating = $state(false);

const statusConfig = {
    in_stock: {
        label: "En stock",
        classes: "bg-ink-900 text-white border-ink-900",
    },
    low_stock: {
        label: "Stock bajo",
        classes: "bg-white text-ink-900 border-ink-200",
    },
    out_of_stock: {
        label: "Agotado",
        classes: "bg-white text-ink-300 border-ink-100 line-through decoration-ink-300",
    },
};

async function updateStatus(newStatus: StockStatus) {
    if (isUpdating || newStatus === stockStatus) {
        showDropdown = false;
        return;
    }

    isUpdating = true;
    const previousStatus = stockStatus;

    try {
        const res = await fetch(`/api/catalog/${productId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stock_status: newStatus }),
        });

        if (!res.ok) {
            throw new Error("Error al actualizar");
        }

        onUpdate(newStatus);
        toasts.success(`${productName}: ${statusConfig[newStatus].label}`);
    } catch (error) {
        onUpdate(previousStatus);
        toasts.error(`Error al actualizar ${productName}`);
    } finally {
        isUpdating = false;
        showDropdown = false;
    }
}

function handleClickOutside(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".stock-badge-container")) {
        showDropdown = false;
    }
}

$effect(() => {
    if (showDropdown) {
        document.addEventListener("click", handleClickOutside);
        return () => {
            document.removeEventListener("click", handleClickOutside);
        };
    }
});
</script>

<div class="stock-badge-container">
    <button
        class="stock-badge {statusConfig[stockStatus].classes} {canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}"
        onclick={() => canEdit && !isUpdating && (showDropdown = !showDropdown)}
        disabled={!canEdit || isUpdating}
    >
        <span class="stock-badge-label">{statusConfig[stockStatus].label}</span>
        {#if canEdit}
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="stock-badge-icon">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        {/if}
    </button>

    {#if showDropdown && canEdit}
        <div class="stock-dropdown">
            {#each Object.entries(statusConfig) as [status, config]}
                <button
                    class="stock-dropdown-item {status === stockStatus ? 'bg-cream-200' : 'bg-white hover:bg-cream-100'}"
                    onclick={() => updateStatus(status as StockStatus)}
                    disabled={isUpdating}
                >
                    {config.label}
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
.stock-badge-container {
    position: relative;
    display: inline-block;
}

.stock-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.75rem;
    border: 1px solid;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    transition: all 0.2s;
    border-radius: 9999px;
}

.stock-badge:disabled {
    opacity: 1;
}

.stock-badge-label {
    white-space: nowrap;
}

.stock-badge-icon {
    flex-shrink: 0;
    transition: transform 0.2s;
}

.stock-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 140px;
    background: white;
    border: 1px solid var(--color-ink-200);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    z-index: 50;
    display: flex;
    flex-direction: column;
    margin-top: 0.5rem;
    border-radius: 0.5rem;
    overflow: hidden;
}

.stock-dropdown-item {
    display: flex;
    align-items: center;
    padding: 0.75rem 1rem;
    border: none;
    border-bottom: 1px solid var(--color-ink-50);
    font-size: 0.6875rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
    color: var(--color-ink-600);
}

.stock-dropdown-item:last-child {
    border-bottom: none;
}

.stock-dropdown-item:hover {
    background: var(--color-ink-50);
    color: var(--color-ink-900);
}

.stock-dropdown-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
</style>
