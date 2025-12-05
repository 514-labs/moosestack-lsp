import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import { createTypeScriptService } from './typescriptService';

/**
 * Creates a temporary directory with test files for TypeScript service tests
 */
function createTestProject(files: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-service-test-'));

  for (const [fileName, content] of Object.entries(files)) {
    const filePath = path.join(tmpDir, fileName);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  return tmpDir;
}

/**
 * Cleans up a temporary test directory
 */
function cleanupTestProject(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('TypeScriptService', () => {
  describe('initialize', () => {
    it('initializes successfully with valid tsconfig', () => {
      const projectDir = createTestProject({
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            strict: true,
          },
          include: ['src/**/*'],
        }),
        'src/index.ts': 'export const x = 1;',
      });

      try {
        const service = createTypeScriptService();
        service.initialize(path.join(projectDir, 'tsconfig.json'));

        assert.strictEqual(service.isHealthy(), true);
        assert.strictEqual(service.getError(), null);
      } finally {
        cleanupTestProject(projectDir);
      }
    });

    it('reports error for invalid tsconfig', () => {
      const projectDir = createTestProject({
        'tsconfig.json': 'invalid json {{{',
      });

      try {
        const service = createTypeScriptService();
        service.initialize(path.join(projectDir, 'tsconfig.json'));

        assert.strictEqual(service.isHealthy(), false);
        assert.ok(service.getError() !== null);
      } finally {
        cleanupTestProject(projectDir);
      }
    });

    it('reports error for non-existent tsconfig', () => {
      const service = createTypeScriptService();
      service.initialize('/non/existent/tsconfig.json');

      assert.strictEqual(service.isHealthy(), false);
      assert.ok(service.getError() !== null);
    });
  });

  describe('getSourceFiles', () => {
    it('returns source files from the project', () => {
      const projectDir = createTestProject({
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
          },
          include: ['src/**/*'],
        }),
        'src/index.ts': 'export const x = 1;',
        'src/utils.ts':
          'export function add(a: number, b: number) { return a + b; }',
      });

      try {
        const service = createTypeScriptService();
        service.initialize(path.join(projectDir, 'tsconfig.json'));

        const sourceFiles = service.getSourceFiles();

        // Should have our two source files (excludes declaration files and node_modules)
        assert.strictEqual(sourceFiles.length, 2);

        const fileNames = sourceFiles.map((sf) => path.basename(sf.fileName));
        assert.ok(fileNames.includes('index.ts'));
        assert.ok(fileNames.includes('utils.ts'));
      } finally {
        cleanupTestProject(projectDir);
      }
    });

    it('excludes node_modules and declaration files', () => {
      const projectDir = createTestProject({
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
          },
          include: ['src/**/*'],
        }),
        'src/index.ts': 'export const x = 1;',
      });

      try {
        const service = createTypeScriptService();
        service.initialize(path.join(projectDir, 'tsconfig.json'));

        const sourceFiles = service.getSourceFiles();

        // None should be from node_modules or be .d.ts files
        for (const sf of sourceFiles) {
          assert.ok(
            !sf.fileName.includes('node_modules'),
            `Should not include node_modules: ${sf.fileName}`,
          );
          assert.ok(
            !sf.isDeclarationFile,
            `Should not include declaration files: ${sf.fileName}`,
          );
        }
      } finally {
        cleanupTestProject(projectDir);
      }
    });
  });

  describe('updateFile', () => {
    it('updates file content and rebuilds program', () => {
      const projectDir = createTestProject({
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
          },
          include: ['src/**/*'],
        }),
        'src/index.ts': 'export const x = 1;',
      });

      try {
        const service = createTypeScriptService();
        service.initialize(path.join(projectDir, 'tsconfig.json'));

        // Get initial source file
        const indexPath = path.join(projectDir, 'src/index.ts');
        const initialSf = service.getSourceFile(indexPath);
        assert.ok(initialSf);
        assert.ok(initialSf.text.includes('const x = 1'));

        // Update the file
        service.updateFile(indexPath, 'export const y = 2;');

        // Get updated source file
        const updatedSf = service.getSourceFile(indexPath);
        assert.ok(updatedSf);
        assert.ok(updatedSf.text.includes('const y = 2'));
        assert.ok(!updatedSf.text.includes('const x = 1'));
      } finally {
        cleanupTestProject(projectDir);
      }
    });
  });

  describe('getTypeChecker', () => {
    it('returns a working type checker', () => {
      const projectDir = createTestProject({
        'tsconfig.json': JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
          },
          include: ['src/**/*'],
        }),
        'src/index.ts': 'export const x: number = 1;',
      });

      try {
        const service = createTypeScriptService();
        service.initialize(path.join(projectDir, 'tsconfig.json'));

        const typeChecker = service.getTypeChecker();
        assert.ok(typeChecker);
        assert.strictEqual(typeof typeChecker.getSymbolAtLocation, 'function');
      } finally {
        cleanupTestProject(projectDir);
      }
    });

    it('throws if not initialized', () => {
      const service = createTypeScriptService();

      assert.throws(() => service.getTypeChecker(), {
        message: 'TypeScript service not initialized',
      });
    });
  });
});
