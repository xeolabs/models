import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  plugins: [vue()],
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../build/app', import.meta.url)),
    // Open tabs still reference older lazy viewer chunks after a rebuild.
    // Keep hashed assets available until the server can be stopped for cleanup.
    emptyOutDir: false,
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        'models-client': fileURLToPath(new URL('../src/browser/index.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'models-client' ? 'models-client.js' : 'assets/[name]-[hash].js',
        manualChunks(id) {
          if (id.includes('node_modules/dockview')) return 'layout';
          if (id.includes('node_modules/element-plus') || id.includes('node_modules/@element-plus'))
            return 'controls';
          if (
            id.includes('node_modules/vue/') ||
            id.includes('node_modules/@vue/') ||
            id.includes('node_modules/pinia')
          )
            return 'vue';
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 7421,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:7420', changeOrigin: true },
      '/models/': { target: 'http://127.0.0.1:7420', changeOrigin: true },
    },
  },
});
