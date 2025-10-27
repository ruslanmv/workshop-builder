// workshop_builder/ui/vite.config.ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Use "." as env directory to avoid referencing process.cwd() (no Node types needed)
  const env = loadEnv(mode, ".", "");
  const backend = env.VITE_API_PROXY || "http://localhost:5000";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: backend,
          changeOrigin: true,
          secure: false
        }
      }
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-router-dom", "zustand"]
    },
    build: {
      sourcemap: false,
      outDir: "dist",
      assetsDir: "assets",
      chunkSizeWarningLimit: 800
    },
    // Optional: expose a simple env flag to app code if needed
    define: {
      __APP_ENV__: JSON.stringify(env.APP_ENV ?? "development")
    }
  };
});
