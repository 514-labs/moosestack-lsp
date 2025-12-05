import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/**/*.ts'],
  format: ['cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: false,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
