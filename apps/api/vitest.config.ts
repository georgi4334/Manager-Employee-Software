import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits the decorator metadata NestJS needs for dependency injection (esbuild does not).
const nestCompatible = swc.vite({
  module: { type: 'es6' },
  jsc: {
    target: 'es2022',
    parser: { syntax: 'typescript', decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true },
  },
});

export default defineConfig({
  plugins: [nestCompatible],
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 15_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['test/**/*.int.test.ts'],
        },
      },
      {
        // Database tests share one database, so their files run one at a time.
        extends: true,
        test: { name: 'db', include: ['test/**/*.int.test.ts'], fileParallelism: false },
      },
    ],
  },
});
