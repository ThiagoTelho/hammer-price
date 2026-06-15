import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host: true → escuta em 0.0.0.0 para ser acessível de fora do container Docker.
  server: { port: 5173, host: true },
});
