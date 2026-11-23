import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true, // a API só aceita a origem 5173; em outra porta nada gravaria
    // em dev, /api vai para a API local (as credenciais Pluggy ficam lá); do .env da raiz só se lê PORT
    proxy: { "/api": `http://127.0.0.1:${loadEnv(mode, "..", "PORT").PORT || 3333}` },
  },
}));
