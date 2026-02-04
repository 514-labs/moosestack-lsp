import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createPythonService } from './pythonService';

test('Python Service Tests', async (t) => {
  await t.test('initializes and finds Python files', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'python-service-test-'),
    );

    try {
      // Create Python files
      await fs.writeFile(
        path.join(tmpDir, 'main.py'),
        `from moose_lib import sql
query = sql("SELECT * FROM users")
`,
      );

      const service = createPythonService();
      await service.initialize(tmpDir);

      assert.strictEqual(service.isHealthy(), true);
      assert.strictEqual(service.getError(), null);

      const files = service.getFiles();
      assert.strictEqual(files.length, 1);
      assert.ok(files[0].path.endsWith('main.py'));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('finds Python files in subdirectories', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'python-service-test-'),
    );

    try {
      // Create subdirectory structure
      await fs.mkdir(path.join(tmpDir, 'queries'), { recursive: true });

      await fs.writeFile(path.join(tmpDir, 'main.py'), 'print("Hello")');

      await fs.writeFile(
        path.join(tmpDir, 'queries', 'users.py'),
        `from moose_lib import sql
query = sql("SELECT * FROM users")
`,
      );

      const service = createPythonService();
      await service.initialize(tmpDir);

      const files = service.getFiles();
      assert.strictEqual(files.length, 2);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('ignores venv and __pycache__ directories', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'python-service-test-'),
    );

    try {
      // Create directories that should be ignored
      await fs.mkdir(path.join(tmpDir, 'venv', 'lib'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, '__pycache__'), { recursive: true });

      await fs.writeFile(path.join(tmpDir, 'main.py'), 'print("Hello")');

      await fs.writeFile(
        path.join(tmpDir, 'venv', 'lib', 'something.py'),
        'print("In venv")',
      );

      await fs.writeFile(
        path.join(tmpDir, '__pycache__', 'cached.py'),
        'print("Cached")',
      );

      const service = createPythonService();
      await service.initialize(tmpDir);

      const files = service.getFiles();
      // Should only find main.py
      assert.strictEqual(files.length, 1);
      assert.ok(files[0].path.endsWith('main.py'));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('updateFile updates cached content', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'python-service-test-'),
    );

    try {
      const filePath = path.join(tmpDir, 'main.py');
      await fs.writeFile(filePath, 'print("Hello")');

      const service = createPythonService();
      await service.initialize(tmpDir);

      // Update with new content
      service.updateFile(
        filePath,
        `from moose_lib import sql
query = sql("SELECT * FROM users")
`,
      );

      const file = service.getFile(filePath);
      assert.ok(file);
      assert.ok(file.content.includes('sql("SELECT * FROM users")'));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test(
    'extractSqlLocations extracts SQL from single file',
    async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'python-service-test-'),
      );

      try {
        const filePath = path.join(tmpDir, 'main.py');
        await fs.writeFile(
          filePath,
          `from moose_lib import sql
query = sql("SELECT * FROM users")
`,
        );

        const service = createPythonService();
        await service.initialize(tmpDir);

        const locations = service.extractSqlLocations(filePath);
        assert.strictEqual(locations.length, 1);
        assert.strictEqual(locations[0].templateText, 'SELECT * FROM users');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  );

  await t.test(
    'extractAllSqlLocations extracts SQL from all files',
    async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'python-service-test-'),
      );

      try {
        await fs.writeFile(
          path.join(tmpDir, 'users.py'),
          `from moose_lib import sql
query = sql("SELECT * FROM users")
`,
        );

        await fs.writeFile(
          path.join(tmpDir, 'orders.py'),
          `from moose_lib import sql
query = sql("SELECT * FROM orders")
`,
        );

        const service = createPythonService();
        await service.initialize(tmpDir);

        const locations = service.extractAllSqlLocations();
        assert.strictEqual(locations.length, 2);

        const templates = locations.map((l) => l.templateText);
        assert.ok(templates.includes('SELECT * FROM users'));
        assert.ok(templates.includes('SELECT * FROM orders'));
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    },
  );

  await t.test('getProjectRoot returns initialized root', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'python-service-test-'),
    );

    try {
      await fs.writeFile(path.join(tmpDir, 'main.py'), 'print("Hello")');

      const service = createPythonService();
      await service.initialize(tmpDir);

      assert.strictEqual(service.getProjectRoot(), tmpDir);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  await t.test('isHealthy returns false before initialization', () => {
    const service = createPythonService();
    assert.strictEqual(service.isHealthy(), false);
  });

  await t.test('returns empty for non-existent file', async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'python-service-test-'),
    );

    try {
      await fs.writeFile(path.join(tmpDir, 'main.py'), 'print("Hello")');

      const service = createPythonService();
      await service.initialize(tmpDir);

      const locations = service.extractSqlLocations('/non/existent/file.py');
      assert.strictEqual(locations.length, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
