import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const isDev = mode === 'development';

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
    define: {
      // SECURITY: Only inject the API key in development mode.
      // In production (Vercel), the key stays server-side in the /api/proxy function.
      'process.env.API_KEY': isDev ? JSON.stringify(env.GEMINI_API_KEY) : JSON.stringify(''),
      'process.env.GEMINI_API_KEY': isDev ? JSON.stringify(env.GEMINI_API_KEY) : JSON.stringify('')
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
