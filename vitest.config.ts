import { defineConfig } from "vite-plus";

// Pure Effect/HTTP tests run in Node, without starting the Cloudflare Vite plugin.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    alias: { "cloudflare:workers": new URL("./src/test/cloudflare.ts", import.meta.url).pathname },
  },
});
