import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { MarkupKind } from 'vscode-languageserver/node';
import type { ClickHouseData } from './clickhouseData';
import { createHoverContent, findHoverInfo, getWordAtPosition } from './hover';

// Minimal test data matching completions.test.ts pattern
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

describe('hover', () => {
  describe('getWordAtPosition', () => {
    it('extracts word under cursor', () => {
      const text = 'SELECT count FROM table';
      const word = getWordAtPosition(text, 7); // cursor on 'count'
      assert.strictEqual(word, 'count');
    });

    it('extracts word at start of text', () => {
      const text = 'SELECT foo';
      const word = getWordAtPosition(text, 2);
      assert.strictEqual(word, 'SELECT');
    });

    it('extracts word at end of text', () => {
      const text = 'SELECT foo';
      const word = getWordAtPosition(text, 9);
      assert.strictEqual(word, 'foo');
    });

    it('extracts word containing underscores', () => {
      const text = 'SELECT max_threads';
      const word = getWordAtPosition(text, 10);
      assert.strictEqual(word, 'max_threads');
    });

    it('extracts word containing numbers', () => {
      const text = 'SELECT toUInt32';
      const word = getWordAtPosition(text, 10);
      assert.strictEqual(word, 'toUInt32');
    });

    it('returns empty string when cursor is on whitespace', () => {
      const text = 'SELECT   FROM';
      const word = getWordAtPosition(text, 7);
      assert.strictEqual(word, '');
    });

    it('returns empty string when cursor is on punctuation', () => {
      const text = 'count()';
      const word = getWordAtPosition(text, 6); // cursor on '(' (0-indexed: c=0,o=1,u=2,n=3,t=4,(=5,)=6)
      assert.strictEqual(word, '');
    });

    it('handles cursor at exact start of word', () => {
      const text = 'SELECT count';
      const word = getWordAtPosition(text, 7); // cursor on 'c'
      assert.strictEqual(word, 'count');
    });

    it('handles cursor at exact end of word', () => {
      const text = 'SELECT count FROM';
      const word = getWordAtPosition(text, 11); // cursor after 't' of count
      assert.strictEqual(word, 'count');
    });
  });

  describe('findHoverInfo', () => {
    it('finds function by exact name', () => {
      const info = findHoverInfo('count', testData);
      assert.ok(info);
      assert.strictEqual(info.type, 'function');
      assert.strictEqual(info.name, 'count');
    });

    it('finds function case-insensitively when marked caseInsensitive', () => {
      const info = findHoverInfo('COUNT', testData);
      assert.ok(info);
      assert.strictEqual(info.type, 'function');
      // Should resolve to 'count' or find the alias
    });

    it('finds case-sensitive function only with exact case', () => {
      const info = findHoverInfo('toUInt32', testData);
      assert.ok(info);
      assert.strictEqual(info.type, 'function');
      assert.strictEqual(info.name, 'toUInt32');

      const infoWrongCase = findHoverInfo('touint32', testData);
      assert.strictEqual(infoWrongCase, null);
    });

    it('finds keyword', () => {
      const info = findHoverInfo('SELECT', testData);
      assert.ok(info);
      assert.strictEqual(info.type, 'keyword');
    });

    it('finds keyword case-insensitively', () => {
      const info = findHoverInfo('select', testData);
      assert.ok(info);
      assert.strictEqual(info.type, 'keyword');
    });

    it('finds data type', () => {
      const info = findHoverInfo('UInt32', testData);
      assert.ok(info);
      assert.strictEqual(info.type, 'dataType');
    });

    it('finds table function', () => {
      const info = findHoverInfo('file', testData);
      assert.ok(info);
      assert.strictEqual(info.type, 'tableFunction');
    });

    it('finds setting', () => {
      const info = findHoverInfo('max_threads', testData);
      assert.ok(info);
      assert.strictEqual(info.type, 'setting');
    });

    it('finds MergeTree setting', () => {
      const info = findHoverInfo('index_granularity', testData);
      assert.ok(info);
      assert.strictEqual(info.type, 'mergeTreeSetting');
    });

    it('finds table engine', () => {
      const info = findHoverInfo('MergeTree', testData);
      assert.ok(info);
      assert.strictEqual(info.type, 'tableEngine');
    });

    it('finds format', () => {
      const info = findHoverInfo('JSON', testData);
      assert.ok(info);
      assert.strictEqual(info.type, 'format');
    });

    it('returns null for unknown word', () => {
      const info = findHoverInfo('unknownfunction', testData);
      assert.strictEqual(info, null);
    });

    it('prioritizes functions over keywords when both match', () => {
      // If there was a function named 'SELECT', it should take priority
      // For now, test that function lookup happens first
      const info = findHoverInfo('count', testData);
      assert.strictEqual(info?.type, 'function');
    });
  });

  describe('createHoverContent', () => {
    it('creates markdown content for function', () => {
      const info = findHoverInfo('count', testData);
      assert.ok(info);
      const content = createHoverContent(info);

      assert.strictEqual(content.kind, MarkupKind.Markdown);
      assert.ok(content.value.includes('count'));
      assert.ok(content.value.includes('aggregate function'));
      assert.ok(content.value.includes('Counts the number of rows'));
    });

    it('creates markdown content for function with syntax', () => {
      const info = findHoverInfo('toUInt32', testData);
      assert.ok(info);
      const content = createHoverContent(info);

      assert.strictEqual(content.kind, MarkupKind.Markdown);
      assert.ok(content.value.includes('toUInt32(x)'));
    });

    it('creates markdown content for function with arguments', () => {
      const info = findHoverInfo('toUInt32', testData);
      assert.ok(info);
      const content = createHoverContent(info);

      assert.ok(content.value.includes('Arguments'));
      assert.ok(content.value.includes('x: value to convert'));
    });

    it('creates markdown content for function with return value', () => {
      const info = findHoverInfo('toUInt32', testData);
      assert.ok(info);
      const content = createHoverContent(info);

      assert.ok(content.value.includes('Returns'));
      assert.ok(content.value.includes('UInt32'));
    });

    it('creates markdown content for keyword', () => {
      const info = findHoverInfo('SELECT', testData);
      assert.ok(info);
      const content = createHoverContent(info);

      assert.strictEqual(content.kind, MarkupKind.Markdown);
      assert.ok(content.value.includes('SELECT'));
      assert.ok(content.value.includes('keyword'));
    });

    it('creates markdown content for data type', () => {
      const info = findHoverInfo('UInt32', testData);
      assert.ok(info);
      const content = createHoverContent(info);

      assert.strictEqual(content.kind, MarkupKind.Markdown);
      assert.ok(content.value.includes('UInt32'));
      assert.ok(content.value.includes('data type'));
    });

    it('creates markdown content for aliased data type', () => {
      const info = findHoverInfo('BIGINT', testData);
      assert.ok(info);
      const content = createHoverContent(info);

      assert.ok(content.value.includes('alias'));
      assert.ok(content.value.includes('Int64'));
    });

    it('creates markdown content for table function', () => {
      const info = findHoverInfo('file', testData);
      assert.ok(info);
      const content = createHoverContent(info);

      assert.ok(content.value.includes('file'));
      assert.ok(content.value.includes('table function'));
      assert.ok(content.value.includes('Reads from a file'));
    });

    it('creates markdown content for setting', () => {
      const info = findHoverInfo('max_threads', testData);
      assert.ok(info);
      const content = createHoverContent(info);

      assert.ok(content.value.includes('max_threads'));
      assert.ok(content.value.includes('setting'));
      assert.ok(content.value.includes('UInt64'));
      assert.ok(content.value.includes('Maximum number of threads'));
    });

    it('creates markdown content for table engine', () => {
      const info = findHoverInfo('MergeTree', testData);
      assert.ok(info);
      const content = createHoverContent(info);

      assert.ok(content.value.includes('MergeTree'));
      assert.ok(content.value.includes('table engine'));
    });

    it('creates markdown content for format', () => {
      const info = findHoverInfo('JSON', testData);
      assert.ok(info);
      const content = createHoverContent(info);

      assert.ok(content.value.includes('JSON'));
      assert.ok(content.value.includes('format'));
      assert.ok(content.value.includes('input'));
      assert.ok(content.value.includes('output'));
    });
  });
});
