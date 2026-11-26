import { defineConfig } from 'vitest/config'
import path from 'path'

// 순수 로직(브라우저/CDP 불필요) 단위 테스트용 설정.
// React 플러그인·Tailwind는 필요 없어서 vite.config.ts와 분리했다.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
