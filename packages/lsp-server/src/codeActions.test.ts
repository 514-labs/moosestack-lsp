import assert from 'node:assert';
import { test } from 'node:test';
import ts from 'typescript';
import {
  createFormatSqlEdit,
  extractOriginalExpressions,
  findSqlTemplateAtPosition,
  findTemplateNodeById,
} from './codeActions';
import type { SqlLocation } from './sqlLocations';

test('findSqlTemplateAtPosition Tests', async (t) => {
  const locations: SqlLocation[] = [
    {
      id: 'test.ts:5:10',
      file: '/project/test.ts',
      line: 5,
      column: 10,
      endLine: 5,
      endColumn: 50,
      templateText: 'SELECT * FROM users',
    },
    {
      id: 'test.ts:10:5',
      file: '/project/test.ts',
      line: 10,
      column: 5,
      endLine: 15,
      endColumn: 10,
      templateText: 'SELECT ${...} FROM ${...}',
    },
  ];

  await t.test('finds template when cursor is inside', () => {
    // Cursor at line 5, column 20 (inside first template)
    const result = findSqlTemplateAtPosition(locations, 4, 20); // 0-indexed

    assert.ok(result);
    assert.strictEqual(result.id, 'test.ts:5:10');
  });

  await t.test('finds multiline template when cursor is inside', () => {
    // Cursor at line 12 (inside second template which spans lines 10-15)
    const result = findSqlTemplateAtPosition(locations, 11, 5); // 0-indexed

    assert.ok(result);
    assert.strictEqual(result.id, 'test.ts:10:5');
  });

  await t.test('returns undefined when cursor is outside all templates', () => {
    // Cursor at line 1 (before any template)
    const result = findSqlTemplateAtPosition(locations, 0, 0);

    assert.strictEqual(result, undefined);
  });

  await t.test(
    'returns undefined when cursor is after template on same line',
    () => {
      // Cursor at line 5, column 55 (after first template ends at 50)
      const result = findSqlTemplateAtPosition(locations, 4, 55);

      assert.strictEqual(result, undefined);
    },
  );

  await t.test('returns undefined for empty locations', () => {
    const result = findSqlTemplateAtPosition([], 5, 10);

    assert.strictEqual(result, undefined);
  });
});

// Helper to create a source file and find the first tagged template expression
function createSourceFileWithSqlTemplate(code: string): {
  sourceFile: ts.SourceFile;
  templateNode: ts.TaggedTemplateExpression | undefined;
} {
  const sourceFile = ts.createSourceFile(
    'test.ts',
    code,
    ts.ScriptTarget.Latest,
    true,
  );

  let templateNode: ts.TaggedTemplateExpression | undefined;

  function visit(node: ts.Node): void {
    if (ts.isTaggedTemplateExpression(node)) {
      templateNode = node;
    }
    if (!templateNode) {
      ts.forEachChild(node, visit);
    }
  }

  visit(sourceFile);
  return { sourceFile, templateNode };
}

test('extractOriginalExpressions Tests', async (t) => {
  await t.test('extracts expressions from template with substitutions', () => {
    const code = 'const q = sql`SELECT ${col} FROM ${table}`;';
    const { templateNode } = createSourceFileWithSqlTemplate(code);

    assert.ok(templateNode);
    const expressions = extractOriginalExpressions(templateNode.template);

    assert.strictEqual(expressions.length, 2);
    assert.strictEqual(expressions[0], '${col}');
    assert.strictEqual(expressions[1], '${table}');
  });

  await t.test('returns empty array for template without substitutions', () => {
    const code = 'const q = sql`SELECT * FROM users`;';
    const { templateNode } = createSourceFileWithSqlTemplate(code);

    assert.ok(templateNode);
    const expressions = extractOriginalExpressions(templateNode.template);

    assert.strictEqual(expressions.length, 0);
  });

  await t.test('handles complex expressions', () => {
    const code =
      'const q = sql`SELECT * FROM ${getTable()} WHERE id = ${user.id}`;';
    const { templateNode } = createSourceFileWithSqlTemplate(code);

    assert.ok(templateNode);
    const expressions = extractOriginalExpressions(templateNode.template);

    assert.strictEqual(expressions.length, 2);
    assert.strictEqual(expressions[0], '${getTable()}');
    assert.strictEqual(expressions[1], '${user.id}');
  });
});

test('findTemplateNodeById Tests', async (t) => {
  await t.test('finds template node by location id', () => {
    const code = 'const q = sql`SELECT * FROM users`;';
    const { sourceFile, templateNode } = createSourceFileWithSqlTemplate(code);

    assert.ok(templateNode);

    // Get the expected location ID
    const start = sourceFile.getLineAndCharacterOfPosition(
      templateNode.template.getStart(),
    );
    const locationId = `test.ts:${start.line + 1}:${start.character + 1}`;

    const found = findTemplateNodeById(sourceFile, locationId);

    assert.ok(found);
    assert.strictEqual(found, templateNode);
  });

  await t.test('returns undefined for non-existent location id', () => {
    const code = 'const q = sql`SELECT * FROM users`;';
    const { sourceFile } = createSourceFileWithSqlTemplate(code);

    const found = findTemplateNodeById(sourceFile, 'test.ts:999:999');

    assert.strictEqual(found, undefined);
  });

  await t.test('ignores non-sql tagged templates', () => {
    const code = 'const q = html`<div>Hello</div>`;';
    const sourceFile = ts.createSourceFile(
      'test.ts',
      code,
      ts.ScriptTarget.Latest,
      true,
    );

    const found = findTemplateNodeById(sourceFile, 'test.ts:1:15');

    assert.strictEqual(found, undefined);
  });
});

test('createFormatSqlEdit Tests', async (t) => {
  await t.test('creates edit for simple SQL template', () => {
    const code = 'const q = sql`select * from users`;';
    const { sourceFile, templateNode } = createSourceFileWithSqlTemplate(code);

    assert.ok(templateNode);
    const edit = createFormatSqlEdit(sourceFile, templateNode);

    assert.ok(edit);
    assert.ok(edit.newText.includes('SELECT'));
    assert.ok(edit.newText.includes('FROM'));
  });

  await t.test('preserves placeholders in formatted output', () => {
    const code = 'const q = sql`select ${col} from ${table}`;';
    const { sourceFile, templateNode } = createSourceFileWithSqlTemplate(code);

    assert.ok(templateNode);
    const edit = createFormatSqlEdit(sourceFile, templateNode);

    assert.ok(edit);
    assert.ok(edit.newText.includes('${col}'));
    assert.ok(edit.newText.includes('${table}'));
  });

  await t.test('returns undefined for invalid SQL', () => {
    const code = 'const q = sql`SELCT * FROM users`;';
    const { sourceFile, templateNode } = createSourceFileWithSqlTemplate(code);

    assert.ok(templateNode);
    const edit = createFormatSqlEdit(sourceFile, templateNode);

    assert.strictEqual(edit, undefined);
  });

  await t.test('preserves indentation for multiline template', () => {
    const code = `const q = sql\`
      select * from users
    \`;`;
    const { sourceFile, templateNode } = createSourceFileWithSqlTemplate(code);

    assert.ok(templateNode);
    const edit = createFormatSqlEdit(sourceFile, templateNode);

    assert.ok(edit);
    // Should start with newline (preserving original structure)
    assert.ok(edit.newText.startsWith('\n'), 'Should start with newline');
    // Should have indentation on content lines
    assert.ok(
      edit.newText.includes('      SELECT'),
      'Should preserve 6-space indent',
    );
  });

  await t.test('preserves trailing newline and closing indent', () => {
    const code = `const q = sql\`
      select * from users
    \`;`;
    const { sourceFile, templateNode } = createSourceFileWithSqlTemplate(code);

    assert.ok(templateNode);
    const edit = createFormatSqlEdit(sourceFile, templateNode);

    assert.ok(edit);
    // Should end with newline + trailing indent (4 spaces before backtick)
    assert.ok(
      edit.newText.endsWith('\n    '),
      'Should end with newline and 4-space indent',
    );
  });
});
