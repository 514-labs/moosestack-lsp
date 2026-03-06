import assert from 'node:assert';
import { test } from 'node:test';
import { DiagnosticSeverity, DiagnosticTag } from 'vscode-languageserver/node';
import {
  createDeprecationDiagnostic,
  createLocationDiagnostic,
  DEPRECATED_SQL_TAG_MESSAGE,
  DEPRECATED_SQL_TAG_SOURCE,
} from './diagnostics';
import type { SqlLocation } from './sqlLocations';

test('createLocationDiagnostic Tests', async (t) => {
  await t.test(
    'creates diagnostic with correct file URI from SqlLocation',
    () => {
      const location: SqlLocation = {
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
      };
      const validationError = { message: 'Syntax error near SLECT' };

      const { uri } = createLocationDiagnostic(location, validationError);

      assert.strictEqual(uri, 'file:///project/app/apis/bar.ts');
    },
  );

  await t.test('converts 1-indexed location to 0-indexed LSP range', () => {
    const location: SqlLocation = {
      id: 'app/apis/bar.ts:54:22',
      file: '/project/app/apis/bar.ts',
      line: 54, // 1-indexed
      column: 22, // 1-indexed
      endLine: 61,
      endColumn: 6,
      templateText: 'SELECT ${...}',
      tagKind: 'statement',
      tagLine: 1,
      tagColumn: 1,
      tagEndColumn: 14,
    };
    const validationError = { message: 'Error' };

    const { diagnostic } = createLocationDiagnostic(location, validationError);

    // LSP uses 0-indexed positions
    assert.strictEqual(diagnostic.range.start.line, 53); // 54 - 1
    assert.strictEqual(diagnostic.range.start.character, 21); // 22 - 1
    assert.strictEqual(diagnostic.range.end.line, 60); // 61 - 1
    assert.strictEqual(diagnostic.range.end.character, 5); // 6 - 1
  });

  await t.test('includes error message in diagnostic', () => {
    const location: SqlLocation = {
      id: 'test.ts:1:1',
      file: '/project/test.ts',
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 50,
      templateText: 'SLECT * FROM users',
      tagKind: 'statement',
      tagLine: 1,
      tagColumn: 1,
      tagEndColumn: 14,
    };
    const validationError = { message: 'Expected SELECT, found SLECT' };

    const { diagnostic } = createLocationDiagnostic(location, validationError);

    assert.ok(diagnostic.message.includes('Expected SELECT, found SLECT'));
  });

  await t.test('sets severity to Error and source to moose-sql', () => {
    const location: SqlLocation = {
      id: 'test.ts:1:1',
      file: '/project/test.ts',
      line: 1,
      column: 1,
      endLine: 1,
      endColumn: 50,
      templateText: 'SELECT',
      tagKind: 'statement',
      tagLine: 1,
      tagColumn: 1,
      tagEndColumn: 14,
    };
    const validationError = { message: 'Error' };

    const { diagnostic } = createLocationDiagnostic(location, validationError);

    assert.strictEqual(diagnostic.severity, DiagnosticSeverity.Error);
    assert.strictEqual(diagnostic.source, 'moose-sql');
  });

  await t.test('uses location id in diagnostic message', () => {
    const location: SqlLocation = {
      id: 'app/apis/bar.ts:54:22',
      file: '/project/app/apis/bar.ts',
      line: 54,
      column: 22,
      endLine: 61,
      endColumn: 6,
      templateText: 'SELECT',
      tagKind: 'statement',
      tagLine: 1,
      tagColumn: 1,
      tagEndColumn: 14,
    };
    const validationError = { message: 'Error' };

    const { diagnostic } = createLocationDiagnostic(location, validationError);

    // The message should indicate it's from an inline SQL template
    assert.ok(diagnostic.message.includes('Invalid SQL'));
  });
});

test('createDeprecationDiagnostic Tests', async (t) => {
  await t.test('creates hint diagnostic with Deprecated tag', () => {
    const location: SqlLocation = {
      id: 'test.ts:5:10',
      file: '/project/test.ts',
      line: 5,
      column: 10,
      endLine: 5,
      endColumn: 50,
      templateText: 'SELECT * FROM users',
      tagKind: 'bare',
      tagLine: 5,
      tagColumn: 7,
      tagEndColumn: 10,
    };

    const { uri, diagnostic } = createDeprecationDiagnostic(location);

    assert.strictEqual(uri, 'file:///project/test.ts');
    assert.strictEqual(diagnostic.severity, DiagnosticSeverity.Hint);
    assert.ok(diagnostic.tags?.includes(DiagnosticTag.Deprecated));
    assert.strictEqual(diagnostic.source, DEPRECATED_SQL_TAG_SOURCE);
    assert.strictEqual(diagnostic.message, DEPRECATED_SQL_TAG_MESSAGE);
  });

  await t.test('diagnostic range covers only the tag identifier', () => {
    const location: SqlLocation = {
      id: 'test.ts:10:20',
      file: '/project/test.ts',
      line: 10,
      column: 20,
      endLine: 12,
      endColumn: 5,
      templateText: 'SELECT 1',
      tagKind: 'bare',
      tagLine: 10,
      tagColumn: 17,
      tagEndColumn: 20,
    };

    const { diagnostic } = createDeprecationDiagnostic(location);

    // Range should be on the tag, not the template
    assert.strictEqual(diagnostic.range.start.line, 9); // 0-indexed
    assert.strictEqual(diagnostic.range.start.character, 16); // 0-indexed
    assert.strictEqual(diagnostic.range.end.line, 9);
    assert.strictEqual(diagnostic.range.end.character, 19);
  });
});
