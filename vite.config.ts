// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import os from "os";

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

process.env["VITE_LOCAL_IP"] = getLocalIp();

export default defineConfig({
  vite: {
    server: {
      allowedHosts: ["scheduled-bras-totally-catering.trycloudflare.com"],
    },
  },
  // The Lovable wrapper intentionally exposes a narrow Nitro option type,
  // while Nitro itself supports explicit runtime plugins. Registering this
  // plugin wires Cloudflare's native scheduled event into the existing app.
  nitro: {
    plugins: ["./server/plugins/communication-scheduler.ts"],
  } as unknown as { preset?: string },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
