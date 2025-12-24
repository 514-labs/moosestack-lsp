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
  // Force bundle vscode-languageclient (tsup might treat it as external due to "vscode-" prefix)
  noExternal: ['vscode-languageclient'],
  platform: 'node',
  target: 'node18',
});
