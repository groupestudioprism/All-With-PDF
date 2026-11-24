import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le site compilé est écrit dans docs/ (publié par GitHub Pages en mode « Deploy from a branch »).
// base './' : fonctionne à la racine comme sous un sous-chemin.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'docs', emptyOutDir: true, chunkSizeWarningLimit: 2500, rollupOptions: { input: 'app.html' } },
});
