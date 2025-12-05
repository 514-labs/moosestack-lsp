import * as assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';
import {
  CompletionItemKind,
  InsertTextFormat,
} from 'vscode-languageserver/node';
import type { ClickHouseData } from './clickhouseData';
import {
  clearCompletionCache,
  filterCompletions,
  generateCompletionItems,
} from './completions';

// Minimal test data
const testData: ClickHouseData = {
  version: '25.8',
  extractedAt: '2025-01-01T00:00:00Z',
  functions: [
    {
      name: 'count',
      isAggregate: true,
      caseInsensitive: true,
      aliasTo: null,
      syntax: 'count()',
      description: 'Counts the number of rows.',
      arguments: '',
      returnedValue: 'UInt64',
      examples: '',
      categories: 'Aggregate',
    },
    {
      name: 'toUInt32',
      isAggregate: false,
      caseInsensitive: false,
      aliasTo: null,
      syntax: 'toUInt32(x)',
      description: 'Converts to UInt32.',
      arguments: '- x: value to convert',
      returnedValue: 'UInt32',
      examples: '',
      categories: 'Type Conversion',
    },
    {
      name: 'COUNT',
      isAggregate: true,
      caseInsensitive: true,
      aliasTo: 'count',
      syntax: '',
      description: '',
      arguments: '',
      returnedValue: '',
      examples: '',
      categories: '',
    },
  ],
  keywords: ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY'],
  dataTypes: [
    { name: 'UInt32', caseInsensitive: false, aliasTo: null },
    { name: 'String', caseInsensitive: false, aliasTo: null },
    { name: 'BIGINT', caseInsensitive: true, aliasTo: 'Int64' },
  ],
  tableEngines: [
    {
      name: 'MergeTree',
      supportsSettings: true,
      supportsSkippingIndices: true,
      supportsProjections: true,
      supportsSortOrder: true,
      supportsTTL: true,
      supportsReplication: false,
      supportsDeduplication: false,
      supportsParallelInsert: true,
    },
  ],
  formats: [
    { name: 'JSON', isInput: true, isOutput: true },
    { name: 'CSVWithNames', isInput: true, isOutput: true },
  ],
  tableFunctions: [
    { name: 'file', description: 'Reads from a file.' },
    { name: 'url', description: 'Reads from a URL.' },
  ],
  aggregateCombinators: ['If', 'Array'],
  settings: [
    {
      name: 'max_threads',
      type: 'UInt64',
      description: 'Maximum number of threads.',
    },
  ],
  mergeTreeSettings: [
    {
      name: 'index_granularity',
      type: 'UInt64',
      description: 'Index granularity.',
    },
  ],
};

describe('completions', () => {
  beforeEach(() => {
    clearCompletionCache();
  });

  describe('generateCompletionItems', () => {
    it('generates completion items from ClickHouse data', () => {
      const items = generateCompletionItems(testData);

      assert.ok(items.length > 0);
      // Should have functions + keywords + data types + engines + formats + table functions + settings
      assert.ok(items.length >= 15);
    });

    it('creates function completions with correct kind', () => {
      const items = generateCompletionItems(testData);

      const countFunc = items.find((i) => i.label === 'count');
      assert.ok(countFunc);
      assert.strictEqual(countFunc.kind, CompletionItemKind.Method); // aggregate

      const toUint32Func = items.find((i) => i.label === 'toUInt32');
      assert.ok(toUint32Func);
      assert.strictEqual(toUint32Func.kind, CompletionItemKind.Function); // non-aggregate
    });

    it('creates function completions with snippet insert', () => {
      const items = generateCompletionItems(testData);

      const func = items.find((i) => i.label === 'count');
      assert.ok(func);
      assert.strictEqual(func.insertText, 'count($1)$0');
      assert.strictEqual(func.insertTextFormat, InsertTextFormat.Snippet);
    });

    it('creates keyword completions', () => {
      const items = generateCompletionItems(testData);

      const selectKeyword = items.find((i) => i.label === 'SELECT');
      assert.ok(selectKeyword);
      assert.strictEqual(selectKeyword.kind, CompletionItemKind.Keyword);
    });

    it('creates data type completions', () => {
      const items = generateCompletionItems(testData);

      const uint32Type = items.find((i) => i.label === 'UInt32');
      assert.ok(uint32Type);
      assert.strictEqual(uint32Type.kind, CompletionItemKind.TypeParameter);
    });

    it('marks aliases with lower sort priority', () => {
      const items = generateCompletionItems(testData);

      const aliasFunc = items.find((i) => i.label === 'COUNT');
      assert.ok(aliasFunc);
      assert.ok(aliasFunc.sortText?.startsWith('zzz_'));
      assert.ok(aliasFunc.detail?.includes('alias'));

      const bigintType = items.find((i) => i.label === 'BIGINT');
      assert.ok(bigintType);
      assert.ok(bigintType.sortText?.startsWith('zzz_'));
    });

    it('creates table engine completions', () => {
      const items = generateCompletionItems(testData);

      const mergeTree = items.find((i) => i.label === 'MergeTree');
      assert.ok(mergeTree);
      assert.strictEqual(mergeTree.kind, CompletionItemKind.Class);
    });

    it('creates format completions with input/output info', () => {
      const items = generateCompletionItems(testData);

      const jsonFormat = items.find((i) => i.label === 'JSON');
      assert.ok(jsonFormat);
      assert.strictEqual(jsonFormat.kind, CompletionItemKind.Constant);
      assert.ok(jsonFormat.detail?.includes('input/output'));
    });

    it('creates table function completions', () => {
      const items = generateCompletionItems(testData);

      const fileFunc = items.find((i) => i.label === 'file');
      assert.ok(fileFunc);
      assert.strictEqual(fileFunc.kind, CompletionItemKind.Function);
      assert.strictEqual(fileFunc.insertText, 'file($1)$0');
    });

    it('creates setting completions', () => {
      const items = generateCompletionItems(testData);

      const maxThreads = items.find((i) => i.label === 'max_threads');
      assert.ok(maxThreads);
      assert.strictEqual(maxThreads.kind, CompletionItemKind.Property);
      assert.ok(maxThreads.detail?.includes('setting'));
    });

    it('creates MergeTree setting completions with distinct label', () => {
      const items = generateCompletionItems(testData);

      const indexGranularity = items.find(
        (i) => i.label === 'index_granularity',
      );
      assert.ok(indexGranularity);
      assert.ok(indexGranularity.detail?.includes('MergeTree'));
    });

    it('caches completion items', () => {
      const items1 = generateCompletionItems(testData);
      const items2 = generateCompletionItems(testData);

      assert.strictEqual(items1, items2); // Same reference = cached
    });

    it('regenerates when version changes', () => {
      const items1 = generateCompletionItems(testData);

      const newData = { ...testData, version: '25.9' };
      const items2 = generateCompletionItems(newData);

      assert.notStrictEqual(items1, items2); // Different reference
    });
  });

  describe('filterCompletions', () => {
    it('returns all items when prefix is empty', () => {
      const items = generateCompletionItems(testData);
      const filtered = filterCompletions(items, '');

      assert.strictEqual(filtered.length, items.length);
    });

    it('filters by case-insensitive prefix', () => {
      const items = generateCompletionItems(testData);

      const filtered = filterCompletions(items, 'sel');
      assert.ok(filtered.some((i) => i.label === 'SELECT'));

      const filteredUpper = filterCompletions(items, 'SEL');
      assert.ok(filteredUpper.some((i) => i.label === 'SELECT'));
    });

    it('filters functions by prefix', () => {
      const items = generateCompletionItems(testData);

      const filtered = filterCompletions(items, 'to');
      assert.ok(filtered.some((i) => i.label === 'toUInt32'));
      assert.ok(!filtered.some((i) => i.label === 'count'));
    });

    it('returns empty array when no matches', () => {
      const items = generateCompletionItems(testData);

      const filtered = filterCompletions(items, 'xyz123nonexistent');
      assert.strictEqual(filtered.length, 0);
    });
  });
});
