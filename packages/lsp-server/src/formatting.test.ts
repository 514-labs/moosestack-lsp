import assert from 'node:assert';
import { test } from 'node:test';
import {
  formatSqlTemplate,
  mapPlaceholdersToIdentifiers,
  restorePlaceholders,
} from './formatting';

test('Placeholder Mapping Tests', async (t) => {
  await t.test('maps ${...} to _ph_N identifiers', () => {
    const input = 'SELECT ${...} FROM ${...} WHERE id = ${...}';
    const { prepared, placeholders } = mapPlaceholdersToIdentifiers(input);

    assert.strictEqual(prepared, 'SELECT _ph_1 FROM _ph_2 WHERE id = _ph_3');
    assert.strictEqual(placeholders.length, 3);
    assert.strictEqual(placeholders[0], '${...}');
    assert.strictEqual(placeholders[1], '${...}');
    assert.strictEqual(placeholders[2], '${...}');
  });

  await t.test('handles SQL with no placeholders', () => {
    const input = 'SELECT * FROM users';
    const { prepared, placeholders } = mapPlaceholdersToIdentifiers(input);

    assert.strictEqual(prepared, 'SELECT * FROM users');
    assert.strictEqual(placeholders.length, 0);
  });

  await t.test('restores placeholders from formatted SQL', () => {
    const formatted = 'SELECT _ph_1 FROM _ph_2 WHERE id = _ph_3';
    const placeholders = ['${col}', '${table}', '${id}'];

    const result = restorePlaceholders(formatted, placeholders);

    assert.strictEqual(result, 'SELECT ${col} FROM ${table} WHERE id = ${id}');
  });

  await t.test('handles placeholder in string literal', () => {
    const input = "SELECT * FROM users WHERE name = '${...}'";
    const { prepared, placeholders } = mapPlaceholdersToIdentifiers(input);

    assert.strictEqual(prepared, "SELECT * FROM users WHERE name = '_ph_1'");
    assert.strictEqual(placeholders.length, 1);
  });

  await t.test('round-trips correctly', () => {
    const original = 'SELECT ${...}, ${...} FROM ${...}';
    const originalPlaceholderTexts = ['${col1}', '${col2}', '${table}'];

    const { prepared } = mapPlaceholdersToIdentifiers(original);
    // Simulate what formatSql would do (uppercase keywords)
    const formatted = prepared.toUpperCase();
    const restored = restorePlaceholders(formatted, originalPlaceholderTexts);

    assert.strictEqual(restored, 'SELECT ${col1}, ${col2} FROM ${table}');
  });
});

test('formatSqlTemplate Tests', async (t) => {
  await t.test('formats SQL and restores placeholders', () => {
    const template = 'select ${...} from ${...} where id=${...}';
    const originalExprs = ['${col}', '${table}', '${id}'];

    const result = formatSqlTemplate(template, originalExprs);

    assert.ok(result.success);
    assert.ok(result.formatted);
    assert.ok(result.formatted.includes('${col}'));
    assert.ok(result.formatted.includes('${table}'));
    assert.ok(result.formatted.includes('${id}'));
    assert.ok(result.formatted.includes('SELECT'));
  });

  await t.test('returns error for invalid SQL', () => {
    const template = 'SELCT ${...} FROM ${...}';
    const originalExprs = ['${col}', '${table}'];

    const result = formatSqlTemplate(template, originalExprs);

    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  await t.test('handles SQL with no placeholders', () => {
    const template = 'select * from users';
    const originalExprs: string[] = [];

    const result = formatSqlTemplate(template, originalExprs);

    assert.ok(result.success);
    assert.ok(result.formatted);
    assert.ok(result.formatted.includes('SELECT'));
  });
});
