<script lang="ts">
type Props = {
  value: string;
  onValueChange?: (value: string) => void;
  children: any;
};

let { value = $bindable(), onValueChange, children }: Props = $props();

function setValue(newValue: string) {
  value = newValue;
  onValueChange?.(newValue);
}

import { setContext } from "svelte";
setContext("tabs", {
  getValue: () => value,
  setValue,
});
</script>

<div class="flex flex-col gap-4">
  {@render children()}
</div>
