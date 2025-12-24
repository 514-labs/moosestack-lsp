import * as fs from 'node:fs';
import * as path from 'node:path';
import { defineConfig } from 'tsup';

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

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
  onSuccess: async () => {
    // Copy data directory to dist
    const srcData = path.join(__dirname, 'src', 'data');
    const distData = path.join(__dirname, 'dist', 'data');

    if (fs.existsSync(srcData)) {
      fs.mkdirSync(distData, { recursive: true });
      const files = fs.readdirSync(srcData);
      for (const file of files) {
        fs.copyFileSync(path.join(srcData, file), path.join(distData, file));
      }
      console.log(`Copied ${files.length} data files to dist/data`);
    }

    // Bundle sql-validator-wasm into node_modules for standalone npm package
    const wasmPkgSrc = path.join(__dirname, '..', 'sql-validator-wasm');
    const wasmPkgDest = path.join(
      __dirname,
      'dist',
      'node_modules',
      '@514labs',
      'moose-sql-validator-wasm',
    );

    if (fs.existsSync(wasmPkgSrc)) {
      // Copy dist/ (compiled JS)
      const wasmDist = path.join(wasmPkgSrc, 'dist');
      if (fs.existsSync(wasmDist)) {
        copyDirRecursive(wasmDist, path.join(wasmPkgDest, 'dist'));
      }

      // Copy pkg/ (WASM binary)
      const wasmPkg = path.join(wasmPkgSrc, 'pkg');
      if (fs.existsSync(wasmPkg)) {
        copyDirRecursive(wasmPkg, path.join(wasmPkgDest, 'pkg'));
      }

      // Copy package.json
      const pkgJson = path.join(wasmPkgSrc, 'package.json');
      if (fs.existsSync(pkgJson)) {
        fs.copyFileSync(pkgJson, path.join(wasmPkgDest, 'package.json'));
      }

      console.log('Bundled sql-validator-wasm into dist/node_modules');
    }
  },
});
