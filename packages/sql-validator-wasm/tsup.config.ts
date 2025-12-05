import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/index.test.ts'],
  format: ['cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  bundle: false,
  external: ['../pkg/sql_validator.js'],
});
