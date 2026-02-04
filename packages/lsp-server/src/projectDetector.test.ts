import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
  detectMooseProject,
  detectMooseProjectWithInfo,
} from './projectDetector';

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

test('Python Project Detection Tests', async (t) => {
  await t.test('finds Python Moose project via pyproject.toml', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moose-lsp-test-'));

    try {
      // Create pyproject.toml with moose-lib dependency
      await fs.writeFile(
        path.join(tmpDir, 'pyproject.toml'),
        `[project]
name = "test-project"
dependencies = [
    "moose-lib>=0.6.0",
]
`,
      );

      const result = await detectMooseProject(tmpDir);
      assert.strictEqual(result, tmpDir);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('finds Python Moose project via requirements.txt', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moose-lsp-test-'));

    try {
      // Create requirements.txt with moose-lib dependency
      await fs.writeFile(
        path.join(tmpDir, 'requirements.txt'),
        `flask>=2.0.0
moose-lib>=0.6.0
requests>=2.28.0
`,
      );

      const result = await detectMooseProject(tmpDir);
      assert.strictEqual(result, tmpDir);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('finds Python Moose project via setup.py', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moose-lsp-test-'));

    try {
      // Create setup.py with moose-lib dependency
      await fs.writeFile(
        path.join(tmpDir, 'setup.py'),
        `from setuptools import setup

setup(
    name="test-project",
    install_requires=[
        "moose-lib>=0.6.0",
    ],
)
`,
      );

      const result = await detectMooseProject(tmpDir);
      assert.strictEqual(result, tmpDir);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test(
    'detects moose_lib with underscore in pyproject.toml',
    async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moose-lsp-test-'),
      );

      try {
        await fs.writeFile(
          path.join(tmpDir, 'pyproject.toml'),
          `[project]
name = "test-project"
dependencies = [
    "moose_lib>=0.6.0",
]
`,
        );

        const result = await detectMooseProject(tmpDir);
        assert.strictEqual(result, tmpDir);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  );

  await t.test(
    'returns null for Python project without moose-lib',
    async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moose-lsp-test-'),
      );

      try {
        await fs.writeFile(
          path.join(tmpDir, 'requirements.txt'),
          `flask>=2.0.0
requests>=2.28.0
`,
        );

        const result = await detectMooseProject(tmpDir);
        assert.strictEqual(result, null);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  );
});

test('Project Detection With Info Tests', async (t) => {
  await t.test('returns typescript type for TypeScript project', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moose-lsp-test-'));

    try {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          dependencies: {
            '@514labs/moose-lib': '^1.0.0',
          },
        }),
      );

      const result = await detectMooseProjectWithInfo(tmpDir);
      assert.ok(result);
      assert.strictEqual(result.root, tmpDir);
      assert.strictEqual(result.type, 'typescript');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('returns python type for Python project', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moose-lsp-test-'));

    try {
      await fs.writeFile(
        path.join(tmpDir, 'pyproject.toml'),
        `[project]
name = "test-project"
dependencies = ["moose-lib>=0.6.0"]
`,
      );

      const result = await detectMooseProjectWithInfo(tmpDir);
      assert.ok(result);
      assert.strictEqual(result.root, tmpDir);
      assert.strictEqual(result.type, 'python');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test(
    'returns both type for project with both languages',
    async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moose-lsp-test-'),
      );

      try {
        // Create both TypeScript and Python config files
        await fs.writeFile(
          path.join(tmpDir, 'package.json'),
          JSON.stringify({
            name: 'test-project',
            dependencies: {
              '@514labs/moose-lib': '^1.0.0',
            },
          }),
        );

        await fs.writeFile(
          path.join(tmpDir, 'pyproject.toml'),
          `[project]
name = "test-project"
dependencies = ["moose-lib>=0.6.0"]
`,
        );

        const result = await detectMooseProjectWithInfo(tmpDir);
        assert.ok(result);
        assert.strictEqual(result.root, tmpDir);
        assert.strictEqual(result.type, 'both');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  );

  await t.test('returns null for project without moose-lib', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moose-lsp-test-'));

    try {
      await fs.writeFile(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          dependencies: {
            express: '^4.0.0',
          },
        }),
      );

      const result = await detectMooseProjectWithInfo(tmpDir);
      assert.strictEqual(result, null);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
