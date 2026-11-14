import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:8765" } },
  plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" },
});
