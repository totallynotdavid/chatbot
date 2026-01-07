<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import type {
    Product,
    Bundle,
    CatalogPeriod,
    StockStatus,
  } from "@totem/types";
  import { auth } from "$lib/state/auth.svelte";
  import { fetchApi } from "$lib/utils/api";
  import PageHeader from "$lib/components/shared/page-header.svelte";
  import Button from "$lib/components/ui/button.svelte";
  import InventoryGrid from "$lib/components/catalog/inventory-grid.svelte";
  import BundleGrid from "$lib/components/catalog/bundle-grid.svelte";
  import PeriodSelector from "$lib/components/catalog/period-selector.svelte";
  import PageTitle from "$lib/components/shared/page-title.svelte";
  import Tabs from "$lib/components/ui/tabs.svelte";
  import TabsList from "$lib/components/ui/tabs-list.svelte";
  import TabsTrigger from "$lib/components/ui/tabs-trigger.svelte";
  import TabsContent from "$lib/components/ui/tabs-content.svelte";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  let activeTab = $state("inventory");

  // Local state for optimistic updates
  let localBaseProducts = $state<Product[]>([]);
  let localBundles = $state<Bundle[]>([]);
  let localFnbBundles = $state<Bundle[]>([]);
  let localPeriods = $state<CatalogPeriod[]>([]);
  let selectedPeriod = $state<CatalogPeriod | null>(null);

  // Derived data
  let baseProducts = $derived(
    localBaseProducts.length > 0 ? localBaseProducts : data.baseProducts,
  );
  let bundles = $derived(localBundles.length > 0 ? localBundles : data.bundles);
  let fnbBundles = $derived(
    localFnbBundles.length > 0 ? localFnbBundles : data.fnbOfferings,
  );
  let periods = $derived(localPeriods.length > 0 ? localPeriods : data.periods);
  let currentPeriod = $derived(selectedPeriod || data.activePeriod);

  // Permissions
  let canEdit = $derived(
    auth.canEditCatalog && currentPeriod?.status === "draft",
  );

  async function loadData(periodId?: string) {
    try {
      const pid = periodId || currentPeriod?.id;

      // Parallel fetch
      const [pRes, bRes, fRes] = await Promise.all([
        fetchApi<Product[]>("/api/catalog/products"),
        pid
          ? fetchApi<Bundle[]>(
              `/api/catalog/bundles?period_id=${pid}&segment=gaso`,
            )
          : Promise.resolve([]),
        pid
          ? fetchApi<Bundle[]>(
              `/api/catalog/bundles?period_id=${pid}&segment=fnb`,
            )
          : Promise.resolve([]),
      ]);

      localBaseProducts = pRes;
      localBundles = bRes;
      localFnbBundles = fRes;
    } catch (error) {
      console.error("Failed to load catalog data:", error);
    }
  }

  async function loadPeriods() {
    try {
      localPeriods = await fetchApi<CatalogPeriod[]>("/api/periods");
    } catch (error) {
      console.error("Failed to load periods:", error);
    }
  }

  function handlePeriodChange(period: CatalogPeriod) {
    selectedPeriod = period;
    goto(`?period=${period.id}`, { replaceState: true });
    loadData(period.id);
  }

  function handleProductClick(product: Product) {
    if (auth.isAdmin) {
      goto(`/dashboard/catalog/inventory/${product.id}`);
    }
  }

  function handleBundleClick(bundle: Bundle) {
    if (canEdit) {
      const pParam = currentPeriod ? `?period=${currentPeriod.id}` : "";
      goto(`/dashboard/catalog/bundles/${bundle.id}${pParam}`);
    }
  }

  function handleFnbBundleClick(bundle: Bundle) {
    if (canEdit) {
      const pParam = currentPeriod ? `?period=${currentPeriod.id}` : "";
      // Use unified bundle editor for both GASO and FnB
      goto(`/dashboard/catalog/bundles/${bundle.id}${pParam}`);
    }
  }

  function handleStockUpdate(id: string, newStatus: StockStatus) {
    if (activeTab === "inventory") {
      // no-op
    } else if (activeTab === "gaso") {
      const item = bundles.find((b: Bundle) => b.id === id);
      if (item) item.stock_status = newStatus;
    } else if (activeTab === "fnb") {
      const item = fnbBundles.find((b: Bundle) => b.id === id);
      if (item) item.stock_status = newStatus;
    }
  }

  function openCreatePage() {
    const pParam = currentPeriod ? `?period=${currentPeriod.id}` : "";
    if (activeTab === "inventory") {
      goto(`/dashboard/catalog/inventory/new`);
    } else if (activeTab === "gaso") {
      goto(`/dashboard/catalog/bundles/new${pParam}`);
    } else if (activeTab === "fnb") {
      goto(`/dashboard/catalog/fnb/new${pParam}`);
    }
  }

  onMount(() => {
    if (!data.user) {
      window.location.href = "/login";
      return;
    }
    loadPeriods();
  });
</script>

<PageTitle title="Catálogo" />

<div class="max-w-7xl mx-auto p-8 md:p-12 min-h-screen">
  <PageHeader
    title="Gestión de catálogo"
    subtitle={currentPeriod
      ? `Período: ${currentPeriod.name}`
      : "Selecciona un período"}
  >
    {#snippet actions()}
      <PeriodSelector
        {periods}
        selected={currentPeriod}
        onSelect={handlePeriodChange}
      />
      {#if auth.isAdmin}
        <Button
          variant="ghost"
          size="sm"
          onclick={() => goto("/dashboard/admin/periods")}
        >
          Gestionar
        </Button>
      {/if}
      {#if canEdit || (activeTab === "inventory" && auth.isAdmin)}
        <Button onclick={openCreatePage}>
          {#if activeTab === "inventory"}
            Nuevo Producto Base
          {:else if activeTab === "gaso"}
            Nuevo Paquete GASO
          {:else}
            Nueva Oferta FNB
          {/if}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  {#if currentPeriod?.status !== "draft" && auth.canEditCatalog && activeTab !== "inventory"}
    <div
      class="mb-6 p-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-md"
    >
      Este período comercial está {currentPeriod?.status === "active"
        ? "activo"
        : "archivado"}. No se pueden modificar las ofertas comerciales.
    </div>
  {/if}

  <Tabs bind:value={activeTab}>
    <TabsList>
      <TabsTrigger value="inventory">Inventario (base)</TabsTrigger>
      <TabsTrigger value="gaso">Gasodomésticos (bundles)</TabsTrigger>
      <TabsTrigger value="fnb">Financiera (FNB)</TabsTrigger>
    </TabsList>

    <TabsContent value="inventory">
      <InventoryGrid
        products={baseProducts}
        canEdit={auth.isAdmin}
        onProductClick={handleProductClick}
      />
    </TabsContent>

    <TabsContent value="gaso">
      {#if !currentPeriod}
        <div class="text-center py-12 text-ink-400">
          Selecciona un período para ver los paquetes.
        </div>
      {:else if bundles.length === 0}
        <div class="text-center py-12 text-ink-400 italic">
          No hay paquetes configurados para este período.
        </div>
      {:else}
        <BundleGrid
          {bundles}
          {canEdit}
          onBundleClick={handleBundleClick}
          onStockUpdate={handleStockUpdate}
        />
      {/if}
    </TabsContent>

    <TabsContent value="fnb">
      {#if !currentPeriod}
        <div class="text-center py-12 text-ink-400">
          Selecciona un período para ver las ofertas.
        </div>
      {:else if fnbBundles.length === 0}
        <div class="text-center py-12 text-ink-400 italic">
          No hay ofertas FNB configuradas para este período.
        </div>
      {:else}
        <BundleGrid
          bundles={fnbBundles}
          {canEdit}
          onBundleClick={handleFnbBundleClick}
          onStockUpdate={handleStockUpdate}
        />
      {/if}
    </TabsContent>
  </Tabs>
</div>
