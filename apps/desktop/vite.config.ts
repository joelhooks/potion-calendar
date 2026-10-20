import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/main.ts",
      fileName: () => "main.js",
      formats: ["es"],
    },
    rolldownOptions: { external: [/^node:/u, "electron"], platform: "node" },
    ssr: true,
    target: "node24",
  },
  ssr: { noExternal: true },
});
