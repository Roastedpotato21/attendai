import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig(({ command, mode }) => ({
  // Public configuration is also required by Nitro's server bundle.
  define: Object.fromEntries(
    Object.entries(loadEnv(mode, process.cwd(), "VITE_")).map(([key, value]) => [
      "import.meta.env." + key,
      JSON.stringify(value),
    ]),
  ),
  resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query", "@tanstack/query-core"] },
  server: { host: "0.0.0.0", port: 8080 },
  plugins: [
    tailwindcss(),
    tsconfigPaths(),
    tanstackStart({
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    ...(command === "build"
      ? [
          nitro({
            defaultPreset: "cloudflare-module",
            plugins: ["./server/plugins/communication-scheduler.ts"],
          }),
        ]
      : []),
    react(),
  ],
}));
