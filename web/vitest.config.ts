import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Deliberately separate from vite.config.ts rather than merging test config
// into it: the WASM/top-level-await plugins there are for the real app
// build and dev server, and unit tests here never load the actual
// spatial-engine WASM module (engineClient.test.ts mocks the Worker
// entirely — see its own comments) — pulling those plugins in would only
// add startup cost and surface area for no benefit to these tests.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
