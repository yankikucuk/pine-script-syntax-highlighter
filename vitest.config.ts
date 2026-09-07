import { defineConfig } from 'vitest/config';

import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { vscode: fileURLToPath(new URL('./tests/core/fake-vscode.ts', import.meta.url)) },
  },
  test: {
    include: ['tests/core/**/*.test.ts'],
    environment: 'node',
  },
});
