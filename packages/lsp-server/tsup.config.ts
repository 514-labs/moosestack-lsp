import * as fs from 'node:fs';
import * as path from 'node:path';
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
  },
});
