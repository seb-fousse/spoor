import process from "node:process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// Keep in sync with `paths` in tsconfig.json.
const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  resolve: {
    alias: {
      "@components": src("components"),
      "@hooks": src("hooks"),
      "@keyboard": src("keyboard"),
      "@lib": src("lib"),
      "@pages": src("pages"),
      "@platform": src("platform"),
      "@routes": src("routes.ts"),
      "@theme": src("theme"),
    },
  },

  // Vite options tailored for Tauri development, applied in `tauri dev`/`tauri build`.
  //
  // 1. Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  // 2. Tauri expects a fixed port and fails if it is not available.
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    // 3. Tell Vite to ignore watching `src-tauri`.
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
