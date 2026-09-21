// Renders one Svelte component to an HTML string, for tests outside this
// workspace. `svelte` resolves only from here, so a test elsewhere goes through
// this file instead of importing `svelte/server` itself.
import "./svelte-ssr.ts";
import { render } from "svelte/server";

export async function renderComponent(
  path: string,
  props: Record<string, unknown>,
): Promise<string> {
  const { default: Component } = await import(path);
  return render(Component, { props }).body;
}
