<script lang="ts">
interface Props {
  title: string;
  separator?: string;
  brand?: string;
}

let { title, separator = " | ", brand = "Totem" }: Props = $props();

let fullTitle = $derived(`${title}${separator}${brand}`);
</script>

<svelte:head>
	<title>{fullTitle}</title>
</svelte:head>
