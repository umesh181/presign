import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Only VITE_* vars reach the browser (e.g. VITE_ARKIV_ACCESS_KEY, VITE_PUBLISHER_ADDRESS).
  envDir: "../..",
});
