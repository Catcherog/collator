import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts', 'src/evaluation/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
        'dist/**',
        'node_modules/**',
        'src/server/domain/ingestion.ts',
        'src/server/repositories/task-repository.ts',
      ],
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
