import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const env = loadEnv(mode, root, "");
  const apiPort = Number(process.env.PORT ?? env.PORT ?? "3000");
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error("API portu 1–65535 arasında olmalıdır.");
  }
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: { "/api": { target: `http://127.0.0.1:${apiPort}` } },
    },
  };
});
