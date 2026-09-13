import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    strictPort: true,
    allowedHosts:
      process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
        ? [
            `${process.env.CODESPACE_NAME}-5173.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`,
          ]
        : [],
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
      '/facebook': 'http://localhost:8787',
      '/webhooks': 'http://localhost:8787',
      '/media': 'http://localhost:8787',
    },
  },
  build: { outDir: 'dist/client' },
});
