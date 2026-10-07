import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false, // Don't wipe dist!
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      name: 'CommywebContent',
      formats: ['iife'],
      fileName: () => 'content.js'
    },
    rollupOptions: {
      output: {
        extend: true
      }
    }
  }
});
