import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cv-challenge/react-plugin': resolve(__dirname, '../../packages/react-plugin/src/index.tsx')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/captcha': 'http://localhost:3000',
      '/verify': 'http://localhost:3000'
    }
  }
});
