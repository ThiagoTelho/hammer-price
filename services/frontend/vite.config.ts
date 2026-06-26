import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // host: true → escuta em 0.0.0.0 para ser acessível de fora do container Docker.
  server: { port: 5173, host: true },
});
