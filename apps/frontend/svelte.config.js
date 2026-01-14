import adapter from "svelte-adapter-bun";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  ...(process.env.NODE_ENV === "development" && {
    vitePlugin: {
      inspector: {
        toggleKeyCombo: "control-shift",
        holdMode: true,
        showToggleButton: "always",
      },
    },
  }),
  kit: {
    adapter: adapter({
      out: "dist",
      precompress: true,
    }),
  },
};

export default config;
