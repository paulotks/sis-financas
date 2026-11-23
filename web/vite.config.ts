import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // em dev, /api vai para a API local (as credenciais Pluggy ficam lá)
    proxy: { "/api": "http://127.0.0.1:3333" },
  },
});
