import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    port: 4500,
  },
  plugins: [
    tsconfigPaths({
      ignoreConfigErrors: true,
    }),
    tailwindcss(),
    tanstackStart({
      srcDirectory: "src",
    }),
    viteReact(),
  ],
});
