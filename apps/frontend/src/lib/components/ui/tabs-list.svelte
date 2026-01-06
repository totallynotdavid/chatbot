<script lang="ts">
let { children }: { children: any } = $props();
</script>

<div class="flex gap-1 border-b border-ink-200">
  {@render children()}
</div>
