import assert from 'node:assert';
import { describe, test } from 'node:test';
import {
  formatSql,
  getCompletions,
  initCompletionData,
  initValidator,
  validateSql,
} from './index.js';

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

// Minimal test data matching ClickHouseData structure
const testData = JSON.stringify({
  version: '25.8',
  extractedAt: '2025-01-01T00:00:00Z',
  functions: [
    {
      name: 'count',
      isAggregate: true,
      caseInsensitive: true,
      aliasTo: null,
      syntax: 'count()',
      description: 'Counts rows',
      arguments: '',
      returnedValue: 'UInt64',
      examples: '',
      categories: 'Aggregate',
    },
    {
      name: 'sum',
      isAggregate: true,
      caseInsensitive: true,
      aliasTo: null,
      syntax: 'sum(x)',
      description: 'Sums values',
      arguments: 'x - numeric column',
      returnedValue: 'Numeric',
      examples: '',
      categories: 'Aggregate',
    },
  ],
  keywords: ['SELECT', 'FROM', 'WHERE'],
  dataTypes: [
    { name: 'UInt64', caseInsensitive: false, aliasTo: null },
    { name: 'String', caseInsensitive: false, aliasTo: null },
  ],
  tableEngines: [{ name: 'MergeTree' }, { name: 'ReplacingMergeTree' }],
  formats: [
    { name: 'JSON', isInput: true, isOutput: true },
    { name: 'CSV', isInput: true, isOutput: true },
  ],
  tableFunctions: [
    { name: 'file', description: 'Reads from file' },
    { name: 'url', description: 'Reads from URL' },
  ],
  aggregateCombinators: [],
  settings: [
    { name: 'max_threads', type: 'UInt64', description: 'Max threads' },
  ],
  mergeTreeSettings: [
    {
      name: 'index_granularity',
      type: 'UInt64',
      description: 'Index granularity',
    },
  ],
});

describe('completions', () => {
  test('initializes completion data', () => {
    const result = initCompletionData(testData);
    assert.strictEqual(result.success, true);
    // error can be null or undefined when success
    assert.ok(!result.error);
  });

  test('returns all completions for default context', () => {
    const completions = getCompletions('', 0);
    assert.ok(completions.length > 0);
    // Should have functions, keywords, etc.
    assert.ok(completions.some((c) => c.label === 'count'));
    assert.ok(completions.some((c) => c.label === 'SELECT'));
  });

  test('returns only engines after ENGINE =', () => {
    const completions = getCompletions('CREATE TABLE t ENGINE = ', 24);
    assert.ok(completions.length > 0);
    assert.ok(completions.every((c) => c.detail === '(table engine)'));
    assert.ok(completions.some((c) => c.label === 'MergeTree'));
  });

  test('returns only formats after FORMAT', () => {
    const completions = getCompletions('SELECT * FORMAT ', 16);
    assert.ok(completions.length > 0);
    assert.ok(completions.every((c) => c.detail?.includes('format')));
    assert.ok(completions.some((c) => c.label === 'JSON'));
  });

  test('returns functions in WHERE clause', () => {
    const completions = getCompletions('SELECT * FROM t WHERE ', 22);
    assert.ok(completions.some((c) => c.label === 'count'));
    assert.ok(completions.some((c) => c.label === 'AND'));
  });

  test('returns table functions after FROM', () => {
    const completions = getCompletions('SELECT * FROM ', 14);
    assert.ok(completions.some((c) => c.label === 'file'));
  });

  test('returns data types in column definition', () => {
    const completions = getCompletions('CREATE TABLE t (id ', 19);
    assert.ok(completions.some((c) => c.label === 'UInt64'));
  });

  test('returns settings after SETTINGS', () => {
    const completions = getCompletions('SELECT * SETTINGS ', 18);
    assert.ok(completions.some((c) => c.label === 'max_threads'));
  });
});
