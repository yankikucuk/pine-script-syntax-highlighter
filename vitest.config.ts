import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/core/**/*.test.ts'],
    environment: 'node',
  },
});
