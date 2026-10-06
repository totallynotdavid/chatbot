// Lets `bun test` import a `.svelte` file and render it to a string.
//
// The runner cannot evaluate Svelte components by itself, so this registers a
// loader that compiles them for the server, the same way the SvelteKit build
// does for server-side rendering. Import it before any `.svelte` file.
import { compile } from "svelte/compiler";

Bun.plugin({
  name: "svelte-ssr",
  setup(build) {
    // Pages import `$app/navigation`, which only exists inside SvelteKit.
    build.module("$app/navigation", () => ({
      exports: { invalidateAll: async () => {} },
      loader: "object",
    }));
    build.onLoad({ filter: /\.svelte$/ }, async ({ path }) => {
      const source = await Bun.file(path).text();
      const { js } = compile(source, {
        filename: path,
        generate: "server",
        dev: false,
      });
      return { contents: js.code, loader: "js" };
    });
  },
});
