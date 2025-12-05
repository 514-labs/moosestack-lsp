import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';
import { extractAllSqlLocations, extractSqlLocations } from './sqlExtractor';

/**
 * Creates a TypeScript program from source code strings for testing.
 * Simulates moose-lib by providing a mock sql function declaration.
 */
function createTestProgram(files: Record<string, string>): {
  program: ts.Program;
  tmpDir: string;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-extractor-test-'));

  // Create a mock moose-lib module with sql function
  const mooseLibDir = path.join(
    tmpDir,
    'node_modules',
    '@514labs',
    'moose-lib',
  );
  fs.mkdirSync(mooseLibDir, { recursive: true });
  fs.writeFileSync(
    path.join(mooseLibDir, 'index.d.ts'),
    `export declare function sql(strings: TemplateStringsArray, ...values: any[]): string;`,
  );
  fs.writeFileSync(
    path.join(mooseLibDir, 'index.js'),
    `module.exports.sql = function sql(strings, ...values) { return strings.join(''); };`,
  );
  fs.writeFileSync(
    path.join(mooseLibDir, 'package.json'),
    JSON.stringify({
      name: '@514labs/moose-lib',
      main: 'index.js',
      types: 'index.d.ts',
    }),
  );

  // Write test files
  for (const [fileName, content] of Object.entries(files)) {
    const filePath = path.join(tmpDir, fileName);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content);
  }

  // Create tsconfig
  const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        strict: true,
        esModuleInterop: true,
        moduleResolution: 'node',
        baseUrl: '.',
        paths: {
          '@514labs/moose-lib': ['node_modules/@514labs/moose-lib'],
        },
      },
      include: ['src/**/*'],
    }),
  );

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    tmpDir,
  );

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });

  return { program, tmpDir };
}

function cleanupTestProject(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('sqlExtractor', () => {
  describe('extractSqlLocations', () => {
    it('extracts sql template from file with moose-lib import', () => {
      const { program, tmpDir } = createTestProgram({
        'src/index.ts': `
import { sql } from '@514labs/moose-lib';

const query = sql\`SELECT * FROM users\`;
`,
      });

      try {
        const sourceFile = program.getSourceFile(
          path.join(tmpDir, 'src/index.ts'),
        );
        assert.ok(sourceFile, 'Source file should exist');

        const typeChecker = program.getTypeChecker();
        const locations = extractSqlLocations(sourceFile, typeChecker);

        assert.strictEqual(locations.length, 1);
        assert.strictEqual(locations[0].templateText, 'SELECT * FROM users');
        assert.strictEqual(locations[0].line, 4);
      } finally {
        cleanupTestProject(tmpDir);
      }
    });

    it('extracts multiple sql templates from same file', () => {
      const { program, tmpDir } = createTestProgram({
        'src/index.ts': `
import { sql } from '@514labs/moose-lib';

const query1 = sql\`SELECT * FROM users\`;
const query2 = sql\`SELECT * FROM orders\`;
const query3 = sql\`SELECT * FROM products\`;
`,
      });

      try {
        const sourceFile = program.getSourceFile(
          path.join(tmpDir, 'src/index.ts'),
        );
        assert.ok(sourceFile);

        const typeChecker = program.getTypeChecker();
        const locations = extractSqlLocations(sourceFile, typeChecker);

        assert.strictEqual(locations.length, 3);
        assert.strictEqual(locations[0].templateText, 'SELECT * FROM users');
        assert.strictEqual(locations[1].templateText, 'SELECT * FROM orders');
        assert.strictEqual(locations[2].templateText, 'SELECT * FROM products');
      } finally {
        cleanupTestProject(tmpDir);
      }
    });

    it('handles template with substitutions', () => {
      const { program, tmpDir } = createTestProgram({
        'src/index.ts': `
import { sql } from '@514labs/moose-lib';

const tableName = 'users';
const column = 'id';
const query = sql\`SELECT \${column} FROM \${tableName} WHERE active = \${true}\`;
`,
      });

      try {
        const sourceFile = program.getSourceFile(
          path.join(tmpDir, 'src/index.ts'),
        );
        assert.ok(sourceFile);

        const typeChecker = program.getTypeChecker();
        const locations = extractSqlLocations(sourceFile, typeChecker);

        assert.strictEqual(locations.length, 1);
        // Substitutions should be replaced with ${...}
        assert.strictEqual(
          locations[0].templateText,
          'SELECT ${...} FROM ${...} WHERE active = ${...}',
        );
      } finally {
        cleanupTestProject(tmpDir);
      }
    });

    it('returns empty array for file without sql templates', () => {
      const { program, tmpDir } = createTestProgram({
        'src/index.ts': `
const x = 1;
const y = 2;
console.log(x + y);
`,
      });

      try {
        const sourceFile = program.getSourceFile(
          path.join(tmpDir, 'src/index.ts'),
        );
        assert.ok(sourceFile);

        const typeChecker = program.getTypeChecker();
        const locations = extractSqlLocations(sourceFile, typeChecker);

        assert.strictEqual(locations.length, 0);
      } finally {
        cleanupTestProject(tmpDir);
      }
    });

    it('extracts sql tag even when symbol cannot be resolved (fallback behavior)', () => {
      // When TypeScript can't resolve the sql symbol (e.g., mock setup issues),
      // we fall back to accepting it (better to have false positives than miss real sql queries)
      const { program, tmpDir } = createTestProgram({
        'src/index.ts': `
// Define our own sql function (not from moose-lib)
function sql(strings: TemplateStringsArray, ...values: any[]) {
  return strings.join('');
}

const query = sql\`SELECT * FROM users\`;
`,
      });

      try {
        const sourceFile = program.getSourceFile(
          path.join(tmpDir, 'src/index.ts'),
        );
        assert.ok(sourceFile);

        const typeChecker = program.getTypeChecker();
        const locations = extractSqlLocations(sourceFile, typeChecker);

        // With fallback behavior, we accept sql tags even when we can't verify
        // they come from moose-lib (better to have false positives)
        assert.strictEqual(locations.length, 1);
      } finally {
        cleanupTestProject(tmpDir);
      }
    });

    it('extracts correct line and column positions', () => {
      const { program, tmpDir } = createTestProgram({
        'src/index.ts': `import { sql } from '@514labs/moose-lib';

const query = sql\`SELECT * FROM users\`;
`,
      });

      try {
        const sourceFile = program.getSourceFile(
          path.join(tmpDir, 'src/index.ts'),
        );
        assert.ok(sourceFile);

        const typeChecker = program.getTypeChecker();
        const locations = extractSqlLocations(sourceFile, typeChecker);

        assert.strictEqual(locations.length, 1);
        assert.strictEqual(locations[0].line, 3);
        // Column should point to the start of the template literal
        assert.ok(locations[0].column > 0);
      } finally {
        cleanupTestProject(tmpDir);
      }
    });
  });

  describe('extractAllSqlLocations', () => {
    it('extracts sql from multiple source files', () => {
      const { program, tmpDir } = createTestProgram({
        'src/queries/users.ts': `
import { sql } from '@514labs/moose-lib';
export const getUsersQuery = sql\`SELECT * FROM users\`;
`,
        'src/queries/orders.ts': `
import { sql } from '@514labs/moose-lib';
export const getOrdersQuery = sql\`SELECT * FROM orders\`;
`,
        'src/index.ts': `
export * from './queries/users';
export * from './queries/orders';
`,
      });

      try {
        const typeChecker = program.getTypeChecker();
        const sourceFiles = program
          .getSourceFiles()
          .filter(
            (sf) =>
              !sf.isDeclarationFile && !sf.fileName.includes('node_modules'),
          );

        const locations = extractAllSqlLocations(sourceFiles, typeChecker);

        assert.strictEqual(locations.length, 2);

        const templates = locations.map((l) => l.templateText);
        assert.ok(templates.includes('SELECT * FROM users'));
        assert.ok(templates.includes('SELECT * FROM orders'));
      } finally {
        cleanupTestProject(tmpDir);
      }
    });
  });
});
