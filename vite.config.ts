import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' : fonctionne tel quel sur GitHub Pages (sous-chemin /all-with-pdf/)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 2500 },
});
