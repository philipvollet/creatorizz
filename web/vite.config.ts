import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Not PORT: dev tooling sets that to the Vite port itself.
const api = `http://127.0.0.1:${process.env.API_PORT ?? 4410}`;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4411,
    strictPort: true,
    proxy: { '/api': api, '/avatars': api, '/thumbs': api },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
