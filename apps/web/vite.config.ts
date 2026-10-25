import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: true, // reachable from phones on your LAN during development
    port: 5173,
    proxy: {
      '/ws': { target: 'http://localhost:3000', ws: true },
      '/healthz': 'http://localhost:3000',
    },
  },
});
