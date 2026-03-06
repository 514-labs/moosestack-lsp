import assert from 'node:assert';
import { test } from 'node:test';
import type { Diagnostic, Range } from 'vscode-languageserver/node';
import {
  type CreateLocationDiagnosticFn,
  shouldValidateFile,
  type ValidateSqlFn,
  validateSqlLocations,
} from './serverLogic';
import type { SqlLocation } from './sqlLocations';

// Helper to create a mock diagnostic
function createMockDiagnostic(message: string): Diagnostic {
  const range: Range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 10 },
  };
  return {
    range,
    message,
    severity: 1, // Error
    source: 'moose-sql',
  };
}

test('shouldValidateFile Tests', async (t) => {
  await t.test('returns false when mooseProjectRoot is null', () => {
    assert.strictEqual(shouldValidateFile('/some/path/file.ts', null), false);
  });

  await t.test('returns false for non-TypeScript files', () => {
    const projectRoot = '/home/user/project';

    assert.strictEqual(
      shouldValidateFile('/home/user/project/src/index.js', projectRoot),
      false,
    );
    assert.strictEqual(
      shouldValidateFile('/home/user/project/package.json', projectRoot),
      false,
    );
    assert.strictEqual(
      shouldValidateFile('/home/user/project/README.md', projectRoot),
      false,
    );
  });

  await t.test('returns false for files outside project', () => {
    const projectRoot = '/home/user/project';

    assert.strictEqual(
      shouldValidateFile('/home/user/other-project/src/index.ts', projectRoot),
      false,
    );
    assert.strictEqual(shouldValidateFile('/tmp/file.ts', projectRoot), false);
  });

  await t.test('returns true for .ts files in project', () => {
    const projectRoot = '/home/user/project';

    assert.strictEqual(
      shouldValidateFile('/home/user/project/src/index.ts', projectRoot),
      true,
    );
    assert.strictEqual(
      shouldValidateFile('/home/user/project/app/models/user.ts', projectRoot),
      true,
    );
  });

  await t.test('handles edge case where file path equals project root', () => {
    const projectRoot = '/home/user/project';

    // A file can't be the same as the project root and end in .ts
    assert.strictEqual(
      shouldValidateFile('/home/user/project', projectRoot),
      false,
    );
  });
});

test('validateSqlLocations Tests', async (t) => {
  await t.test('returns empty map for empty locations', () => {
    const mockValidateSql: ValidateSqlFn = () => ({ valid: true });
    const mockCreateDiagnostic: CreateLocationDiagnosticFn = () => ({
      uri: '',
      diagnostic: createMockDiagnostic(''),
    });

    const result = validateSqlLocations(
      [],
      mockValidateSql,
      mockCreateDiagnostic,
    );

    assert.strictEqual(result.size, 0);
  });

  await t.test('returns diagnostics for invalid SQL in template', () => {
    const locations: SqlLocation[] = [
      {
        id: 'app/apis/bar.ts:54:22',
        file: '/project/app/apis/bar.ts',
        line: 54,
        column: 22,
        endLine: 61,
        endColumn: 6,
        templateText: 'SLECT ${...} FROM ${...}', // typo
        tagKind: 'statement',
        tagLine: 1,
        tagColumn: 1,
        tagEndColumn: 14,
      },
    ];

    const mockValidateSql: ValidateSqlFn = () => ({
      valid: false,
      error: { message: 'Expected SELECT, found SLECT' },
    });

    const mockCreateDiagnostic: CreateLocationDiagnosticFn = (
      location,
      error,
    ) => ({
      uri: `file://${location.file}`,
      diagnostic: createMockDiagnostic(error.message),
    });

    const result = validateSqlLocations(
      locations,
      mockValidateSql,
      mockCreateDiagnostic,
    );

    assert.strictEqual(result.size, 1);
    const diagnostics = result.get('file:///project/app/apis/bar.ts');
    assert.ok(diagnostics);
    assert.strictEqual(diagnostics.length, 1);
    assert.strictEqual(diagnostics[0].message, 'Expected SELECT, found SLECT');
  });

  await t.test('skips valid SQL', () => {
    const locations: SqlLocation[] = [
      {
        id: 'app/apis/bar.ts:54:22',
        file: '/project/app/apis/bar.ts',
        line: 54,
        column: 22,
        endLine: 61,
        endColumn: 6,
        templateText: 'SELECT ${...} FROM ${...}',
        tagKind: 'statement',
        tagLine: 1,
        tagColumn: 1,
        tagEndColumn: 14,
      },
    ];

    const mockValidateSql: ValidateSqlFn = () => ({ valid: true });
    const mockCreateDiagnostic: CreateLocationDiagnosticFn = () => ({
      uri: 'file:///project/app/apis/bar.ts',
      diagnostic: createMockDiagnostic('Should not be called'),
    });

    const result = validateSqlLocations(
      locations,
      mockValidateSql,
      mockCreateDiagnostic,
    );

    assert.strictEqual(result.size, 0);
  });

  await t.test('groups diagnostics by file URI', () => {
    const locations: SqlLocation[] = [
      {
        id: 'app/apis/bar.ts:54:22',
        file: '/project/app/apis/bar.ts',
        line: 54,
        column: 22,
        endLine: 61,
        endColumn: 6,
        templateText: 'SLECT ${...}',
        tagKind: 'statement',
        tagLine: 1,
        tagColumn: 1,
        tagEndColumn: 14,
      },
      {
        id: 'app/apis/bar.ts:100:22',
        file: '/project/app/apis/bar.ts',
        line: 100,
        column: 22,
        endLine: 105,
        endColumn: 6,
        templateText: 'SELCT ${...}',
        tagKind: 'statement',
        tagLine: 1,
        tagColumn: 1,
        tagEndColumn: 14,
      },
    ];

    const mockValidateSql: ValidateSqlFn = () => ({
      valid: false,
      error: { message: 'Syntax error' },
    });

    const mockCreateDiagnostic: CreateLocationDiagnosticFn = (
      location,
      error,
    ) => ({
      uri: `file://${location.file}`,
      diagnostic: createMockDiagnostic(error.message),
    });

    const result = validateSqlLocations(
      locations,
      mockValidateSql,
      mockCreateDiagnostic,
    );

    assert.strictEqual(result.size, 1);
    const diagnostics = result.get('file:///project/app/apis/bar.ts');
    assert.ok(diagnostics);
    assert.strictEqual(diagnostics.length, 2);
  });

  await t.test('handles multiple files', () => {
    const locations: SqlLocation[] = [
      {
        id: 'app/apis/foo.ts:10:5',
        file: '/project/app/apis/foo.ts',
        line: 10,
        column: 5,
        endLine: 15,
        endColumn: 6,
        templateText: 'SLECT ${...}',
        tagKind: 'statement',
        tagLine: 1,
        tagColumn: 1,
        tagEndColumn: 14,
      },
      {
        id: 'app/apis/bar.ts:54:22',
        file: '/project/app/apis/bar.ts',
        line: 54,
        column: 22,
        endLine: 61,
        endColumn: 6,
        templateText: 'SELCT ${...}',
        tagKind: 'statement',
        tagLine: 1,
        tagColumn: 1,
        tagEndColumn: 14,
      },
    ];

    const mockValidateSql: ValidateSqlFn = () => ({
      valid: false,
      error: { message: 'Syntax error' },
    });

    const mockCreateDiagnostic: CreateLocationDiagnosticFn = (
      location,
      error,
    ) => ({
      uri: `file://${location.file}`,
      diagnostic: createMockDiagnostic(error.message),
    });

    const result = validateSqlLocations(
      locations,
      mockValidateSql,
      mockCreateDiagnostic,
    );

    assert.strictEqual(result.size, 2);
    assert.ok(result.has('file:///project/app/apis/foo.ts'));
    assert.ok(result.has('file:///project/app/apis/bar.ts'));
  });

  await t.test(
    'prepares SQL by replacing ${...} placeholders before validation',
    () => {
      const locations: SqlLocation[] = [
        {
          id: 'test.ts:1:1',
          file: '/project/test.ts',
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 50,
          templateText: 'SELECT ${...} FROM ${...}',
          tagKind: 'statement',
          tagLine: 1,
          tagColumn: 1,
          tagEndColumn: 14,
        },
      ];

      let validatedSql = '';
      const mockValidateSql: ValidateSqlFn = (sql) => {
        validatedSql = sql;
        return { valid: true };
      };

      const mockCreateDiagnostic: CreateLocationDiagnosticFn = () => ({
        uri: '',
        diagnostic: createMockDiagnostic(''),
      });

      validateSqlLocations(locations, mockValidateSql, mockCreateDiagnostic);

      // Should have replaced ${...} with placeholders
      assert.ok(!validatedSql.includes('${...}'));
      assert.ok(validatedSql.includes('SELECT'));
      assert.ok(validatedSql.includes('FROM'));
    },
  );

  await t.test('skips validation for fragment tag kind', () => {
    const locations: SqlLocation[] = [
      {
        id: 'test.ts:1:1',
        file: '/project/test.ts',
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 50,
        templateText: 'WHERE id = 1',
        tagKind: 'fragment',
        tagLine: 1,
        tagColumn: 1,
        tagEndColumn: 13,
      },
    ];

    let validateCalled = false;
    const mockValidateSql: ValidateSqlFn = () => {
      validateCalled = true;
      return { valid: false, error: { message: 'Should not be called' } };
    };

    const mockCreateDiagnostic: CreateLocationDiagnosticFn = () => ({
      uri: 'file:///project/test.ts',
      diagnostic: createMockDiagnostic('Should not be called'),
    });

    const result = validateSqlLocations(
      locations,
      mockValidateSql,
      mockCreateDiagnostic,
    );

    assert.strictEqual(validateCalled, false, 'should not validate fragments');
    // No validation diagnostics, but no deprecation either (it's a fragment)
    assert.strictEqual(result.size, 0);
  });

  await t.test('emits deprecation diagnostic for bare sql tag', () => {
    const locations: SqlLocation[] = [
      {
        id: 'test.ts:5:10',
        file: '/project/test.ts',
        line: 5,
        column: 10,
        endLine: 5,
        endColumn: 50,
        templateText: 'SELECT * FROM users',
        tagKind: 'bare',
        tagLine: 5,
        tagColumn: 5,
        tagEndColumn: 8,
      },
    ];

    const mockValidateSql: ValidateSqlFn = () => ({ valid: true });
    const mockCreateDiagnostic: CreateLocationDiagnosticFn = () => ({
      uri: 'file:///project/test.ts',
      diagnostic: createMockDiagnostic('unused'),
    });

    const result = validateSqlLocations(
      locations,
      mockValidateSql,
      mockCreateDiagnostic,
    );

    // Should have deprecation hint even though SQL is valid
    assert.strictEqual(result.size, 1);
    const diagnostics = result.get('file:///project/test.ts');
    assert.ok(diagnostics);
    assert.strictEqual(diagnostics.length, 1);
    assert.ok(diagnostics[0].message.includes('deprecated'));
  });

  await t.test('does not emit deprecation for statement tag kind', () => {
    const locations: SqlLocation[] = [
      {
        id: 'test.ts:1:1',
        file: '/project/test.ts',
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 50,
        templateText: 'SELECT * FROM users',
        tagKind: 'statement',
        tagLine: 1,
        tagColumn: 1,
        tagEndColumn: 14,
      },
    ];

    const mockValidateSql: ValidateSqlFn = () => ({ valid: true });
    const mockCreateDiagnostic: CreateLocationDiagnosticFn = () => ({
      uri: 'file:///project/test.ts',
      diagnostic: createMockDiagnostic('unused'),
    });

    const result = validateSqlLocations(
      locations,
      mockValidateSql,
      mockCreateDiagnostic,
    );

    assert.strictEqual(result.size, 0);
  });
});
