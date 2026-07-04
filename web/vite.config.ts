import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Spatial-compliance/' : '/',
  plugins: [react(), wasm(), topLevelAwait()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  optimizeDeps: {
    exclude: ['spatial-engine'],
  },
  assetsInclude: ['**/*.wasm'],
}));
