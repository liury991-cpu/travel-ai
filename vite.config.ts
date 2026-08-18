import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vercel 部署时前端由 Vite 构建；/api 下的 Serverless 函数由 Vercel 单独托管。
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
