import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'node:path'

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      'liveline-svelte': path.resolve(__dirname, '../src/index.ts'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../dev-dist'),
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        demo: path.resolve(__dirname, 'demo.html'),
      },
    },
  },
})
