import assert from 'node:assert';
import { test } from 'node:test';
import {
  loadSqlLocations,
  prepareSqlForValidation,
  type SqlLocationManifest,
} from './sqlLocations';

test('loadSqlLocations Tests', async (t) => {
  await t.test('parses valid sql-locations.json content', () => {
    const manifest: SqlLocationManifest = {
      version: 1,
      sqlLocations: [
        {
          id: 'app/apis/bar.ts:54:22',
          file: '/project/app/apis/bar.ts',
          line: 54,
          column: 22,
          endLine: 61,
          endColumn: 6,
          templateText:
            '\n      SELECT \n        ${...},\n        ${...}\n      FROM ${...}\n    ',
          tagKind: 'bare',
          tagLine: 54,
          tagColumn: 18,
          tagEndColumn: 21,
        },
      ],
    };

    const result = loadSqlLocations(JSON.stringify(manifest));

    assert.strictEqual(result.version, 1);
    assert.strictEqual(result.sqlLocations.length, 1);
    assert.strictEqual(result.sqlLocations[0].file, '/project/app/apis/bar.ts');
    assert.strictEqual(result.sqlLocations[0].line, 54);
  });

  await t.test('parses tagKind from sql-locations.json', () => {
    const json = JSON.stringify({
      version: 1,
      sqlLocations: [
        {
          id: 'test.ts:1:1',
          file: '/project/test.ts',
          line: 1,
          column: 1,
          endLine: 1,
          endColumn: 50,
          templateText: 'SELECT * FROM users',
          tagKind: 'statement',
        },
      ],
    });

    const manifest = loadSqlLocations(json);
    assert.strictEqual(manifest.sqlLocations[0].tagKind, 'statement');
  });

  await t.test(
    'applies defaults for missing tagKind and tag position fields',
    () => {
      const json = JSON.stringify({
        version: 1,
        sqlLocations: [
          {
            id: 'test.ts:10:5',
            file: '/project/test.ts',
            line: 10,
            column: 5,
            endLine: 10,
            endColumn: 50,
            templateText: 'SELECT * FROM users',
          },
        ],
      });

      const manifest = loadSqlLocations(json);
      const loc = manifest.sqlLocations[0];
      assert.strictEqual(loc.tagKind, 'statement');
      assert.strictEqual(loc.tagLine, 10);
      assert.strictEqual(loc.tagColumn, 5);
      assert.strictEqual(loc.tagEndColumn, 5);
    },
  );

  await t.test('returns empty locations for invalid JSON', () => {
    const result = loadSqlLocations('not valid json');

    assert.strictEqual(result.version, 1);
    assert.strictEqual(result.sqlLocations.length, 0);
  });

  await t.test('returns empty locations for missing sqlLocations field', () => {
    const result = loadSqlLocations('{"version": 1}');

    assert.strictEqual(result.sqlLocations.length, 0);
  });
});

test('prepareSqlForValidation Tests', async (t) => {
  await t.test('replaces ${...} placeholders with valid identifiers', () => {
    const templateText = 'SELECT ${...} FROM ${...}';
    const result = prepareSqlForValidation(templateText);

    // Should replace ${...} with something the SQL parser can handle
    assert.ok(!result.includes('${...}'));
    // The result should be valid SQL structure
    assert.ok(result.includes('SELECT'));
    assert.ok(result.includes('FROM'));
  });

  await t.test('preserves SQL keywords and structure', () => {
    const templateText = 'SELECT ${...} as col FROM ${...} WHERE x > 1';
    const result = prepareSqlForValidation(templateText);

    assert.ok(result.includes('SELECT'));
    assert.ok(result.includes('as col'));
    assert.ok(result.includes('FROM'));
    assert.ok(result.includes('WHERE x > 1'));
  });

  await t.test('handles template with SLECT typo', () => {
    const templateText = 'SLECT ${...} FROM ${...}';
    const result = prepareSqlForValidation(templateText);

    // The typo should be preserved
    assert.ok(result.includes('SLECT'));
  });

  await t.test('handles multi-line templates', () => {
    const templateText = `
      SELECT 
        \${...},
        \${...}
      FROM \${...}
      ORDER BY \${...} DESC
    `;
    const result = prepareSqlForValidation(templateText);

    assert.ok(result.includes('SELECT'));
    assert.ok(result.includes('FROM'));
    assert.ok(result.includes('ORDER BY'));
  });
});
