import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  plugins: [vue()],
  test: {
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      thresholds: { branches: 90, lines: 95, statements: 95, functions: 95 },
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli.ts',
        'src/cli/**/*.ts',
        'src/index.ts',
        'src/domain/types.ts',
        'src/domain/xeokit.ts',
      ],
    },
  },
});
