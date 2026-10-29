import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    proxy: { '/api': { target: 'http://127.0.0.1:4174', changeOrigin: false } },
  },
  build: { target: 'es2023', sourcemap: true },
});
