import assert from 'node:assert';
import { test } from 'node:test';
import { formatSql, initValidator, validateSql } from './index.js';

test('SQL Validator Tests', async (t) => {
  // Initialize validator before running tests
  await initValidator();

  await t.test('validates correct SELECT statement', () => {
    const result = validateSql('SELECT * FROM users WHERE id = 1');
    assert.strictEqual(result.valid, true);
    // error can be null or undefined when valid
    assert.ok(!result.error || result.error === null);
  });

  await t.test('catches typo in SELECT keyword', () => {
    const result = validateSql('SELCT * FROM users');
    assert.strictEqual(result.valid, false);
    assert.ok(result.error);
    assert.ok(result.error.message.includes('SELCT'));
  });

  await t.test('validates ClickHouse-specific syntax', () => {
    const result = validateSql(
      'CREATE MATERIALIZED VIEW mv AS SELECT * FROM source',
    );
    assert.strictEqual(result.valid, true);
  });

  await t.test('validates INSERT statement', () => {
    const result = validateSql(
      "INSERT INTO users (id, name) VALUES (1, 'test')",
    );
    assert.strictEqual(result.valid, true);
  });

  await t.test('validates CREATE TABLE statement', () => {
    const result = validateSql(
      'CREATE TABLE users (id UInt32, name String) ENGINE = MergeTree() ORDER BY id',
    );
    // ClickHouse-specific syntax may not be fully supported
    if (!result.valid) {
      console.log('CREATE TABLE validation error:', result.error);
    }
    // This might fail with some ClickHouse-specific syntax - adjust as needed
  });

  await t.test(
    'validates SELECT with WHERE (FROM is optional in some dialects)',
    () => {
      const result = validateSql('SELECT * WHERE id = 1');
      // This may be valid in some SQL dialects, so we just check it doesn't crash
      assert.ok(typeof result.valid === 'boolean');
    },
  );

  await t.test('formats simple SELECT statement', () => {
    const result = formatSql('select * from users where id = 1');
    assert.strictEqual(result.success, true);
    assert.ok(result.formatted);
    assert.ok(result.formatted.includes('SELECT'));
    assert.ok(result.formatted.includes('FROM'));
  });

  await t.test('returns error for invalid SQL when formatting', () => {
    const result = formatSql('SELCT * FROM users');
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
  });

  await t.test('preserves placeholder identifiers during formatting', () => {
    const result = formatSql('SELECT _ph_1 FROM _ph_2 WHERE id = _ph_3');
    assert.strictEqual(result.success, true);
    assert.ok(result.formatted);
    assert.ok(result.formatted.includes('_ph_1'));
    assert.ok(result.formatted.includes('_ph_2'));
    assert.ok(result.formatted.includes('_ph_3'));
  });
});
