// Lets `bun test` import a `.svelte` file and render it to a string.
//
// The runner cannot evaluate Svelte components by itself, so this registers a
// loader that compiles them for the server, the same way the SvelteKit build
// does for server-side rendering. Import it before any `.svelte` file.
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";

const libDir = fileURLToPath(new URL("..", import.meta.url));

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
      // Bun does not apply the `$lib` alias to a module a plugin produced, so
      // the compiled imports are pointed at the directory instead.
      const contents = js.code.replace(/(from\s+["'])\$lib\//g, `$1${libDir}`);
      return { contents, loader: "js" };
    });
  },
});
