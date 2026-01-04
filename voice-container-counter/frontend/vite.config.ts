import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const allowedHosts = ["vcc.tecosi87.com"];

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 4317,
    strictPort: true,
    allowedHosts,
    proxy: {
      "/api": {
        target: "http://backend:4318",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  },
  preview: {
    host: true,
    port: 4317,
    strictPort: true,
    allowedHosts,
    proxy: {
      "/api": {
        target: "http://backend:4318",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  }
});
