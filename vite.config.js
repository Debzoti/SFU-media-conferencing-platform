import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  root: 'client',
  base: '/dist/',
  build: {
    outDir: '../public/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'client/index.html'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/hls': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
