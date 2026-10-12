import devtoolsJson from "vite-plugin-devtools-json";
import tailwindcss from "@tailwindcss/vite";
import adapter from "@sveltejs/adapter-bun";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      adapter: adapter({
        out: "dist",
        precompress: true,
        // The built server refuses a larger request body before any route
        // runs. Call recordings are the largest upload: an hour of 8 kHz mono
        // WAV is about 55 MiB. `routes/api/webhook` holds Meta's webhook to
        // its own, smaller bound. `BODY_SIZE_LIMIT` overrides this at run time.
        serverOptions: { maxRequestBodySize: 64 * 1024 * 1024 },
      }),
      inspector: {
        toggleKeyCombo: "control-shift",
        holdMode: true,
        showToggleButton: "always",
      },
    }),
    devtoolsJson(),
  ],

  server: {
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app"],
  },
});
