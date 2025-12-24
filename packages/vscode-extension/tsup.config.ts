import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: true,
  external: ['vscode'],
  platform: 'node',
  target: 'node18',
});
