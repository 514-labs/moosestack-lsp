import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { detectMooseProject } from './projectDetector';

test('Project Detection Tests', async (t) => {
  await t.test('finds Moose project in root directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moose-lsp-test-'));

    try {
      // Create package.json with moose-lib dependency
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          dependencies: {
            '@514labs/moose-lib': '^1.0.0',
          },
        }),
      );

      const result = await detectMooseProject(tmpDir);
      assert.strictEqual(result, tmpDir);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('finds Moose project in monorepo subdirectory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moose-lsp-test-'));

    try {
      // Create root package.json without moose-lib
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'monorepo-root',
          private: true,
        }),
      );

      // Create packages directory
      const packagesDir = path.join(tmpDir, 'packages', 'moose-backend');
      await fs.mkdir(packagesDir, { recursive: true });

      // Create package.json with moose-lib in subdirectory
      await fs.writeFile(
        path.join(packagesDir, 'package.json'),
        JSON.stringify({
          name: 'moose-backend',
          dependencies: {
            '@514labs/moose-lib': '^1.0.0',
          },
        }),
      );

      const result = await detectMooseProject(tmpDir);
      assert.strictEqual(result, packagesDir);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('returns null when no Moose project found', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moose-lsp-test-'));

    try {
      // Create package.json without moose-lib
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'non-moose-project',
          dependencies: {
            express: '^4.0.0',
          },
        }),
      );

      const result = await detectMooseProject(tmpDir);
      assert.strictEqual(result, null);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('checks devDependencies as well', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moose-lsp-test-'));

    try {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          devDependencies: {
            '@514labs/moose-lib': '^1.0.0',
          },
        }),
      );

      const result = await detectMooseProject(tmpDir);
      assert.strictEqual(result, tmpDir);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
