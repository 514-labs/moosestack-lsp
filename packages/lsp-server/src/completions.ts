import {
  type CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  MarkupKind,
} from 'vscode-languageserver/node';
import type {
  ClickHouseData,
  DataTypeInfo,
  FunctionInfo,
  SettingInfo,
  TableFunctionInfo,
} from './clickhouseData';

/**
 * Sort priority prefixes for completion items.
 * Lower values = higher priority (alphabetically sorted).
 */
const SortPriority = {
  KEYWORD: '0_',
  FUNCTION: '1_',
  DATA_TYPE: '2_',
  TABLE_ENGINE: '3_',
  FORMAT: '4_',
  TABLE_FUNCTION: '5_',
  SETTING: '6_',
  ALIAS: '9_', // Demoted aliases
} as const;

/**
 * Creates a completion item for a ClickHouse function.
 */
function createFunctionCompletion(
  func: FunctionInfo,
  useSnippets: boolean,
): CompletionItem {
  const item: CompletionItem = {
    label: func.name,
    kind: func.isAggregate
      ? CompletionItemKind.Method
      : CompletionItemKind.Function,
    detail: func.isAggregate ? '(aggregate function)' : '(function)',
  };

  // Use snippet format if client supports it, otherwise plain text with parens
  if (useSnippets) {
    item.insertText = `${func.name}($1)$0`;
    item.insertTextFormat = InsertTextFormat.Snippet;
  } else {
    item.insertText = `${func.name}()`;
    item.insertTextFormat = InsertTextFormat.PlainText;
  }

  // Build documentation
  const docParts: string[] = [];

  if (func.syntax) {
    docParts.push(`**Syntax:** \`${func.syntax}\``);
  }

  if (func.description) {
    docParts.push(func.description.trim());
  }

  if (func.arguments) {
    docParts.push(`**Arguments:**\n${func.arguments.trim()}`);
  }

  if (func.returnedValue) {
    docParts.push(`**Returns:**\n${func.returnedValue.trim()}`);
  }

  if (func.categories) {
    docParts.push(`**Category:** ${func.categories}`);
  }

  if (docParts.length > 0) {
    item.documentation = {
      kind: MarkupKind.Markdown,
      value: docParts.join('\n\n'),
    };
  }

  // Set sort priority - aliases are demoted
  if (func.aliasTo) {
    item.sortText = `${SortPriority.ALIAS}${func.name}`;
    item.detail = `(alias for ${func.aliasTo})`;
  } else {
    item.sortText = `${SortPriority.FUNCTION}${func.name}`;
  }

  return item;
}

/**
 * Creates a completion item for a SQL keyword.
 */
function createKeywordCompletion(keyword: string): CompletionItem {
  return {
    label: keyword,
    kind: CompletionItemKind.Keyword,
    detail: '(keyword)',
    insertText: keyword,
    sortText: `${SortPriority.KEYWORD}${keyword}`,
  };
}

/**
 * Creates a completion item for a ClickHouse data type.
 */
function createDataTypeCompletion(dataType: DataTypeInfo): CompletionItem {
  const item: CompletionItem = {
    label: dataType.name,
    kind: CompletionItemKind.TypeParameter,
    detail: '(data type)',
  };

  // Set sort priority - aliases are demoted
  if (dataType.aliasTo) {
    item.detail = `(alias for ${dataType.aliasTo})`;
    item.sortText = `${SortPriority.ALIAS}${dataType.name}`;
  } else {
    item.sortText = `${SortPriority.DATA_TYPE}${dataType.name}`;
  }

  return item;
}

/**
 * Creates a completion item for a table engine.
 */
function createTableEngineCompletion(engine: string): CompletionItem {
  return {
    label: engine,
    kind: CompletionItemKind.Class,
    detail: '(table engine)',
    sortText: `${SortPriority.TABLE_ENGINE}${engine}`,
  };
}

/**
 * Creates a completion item for a format.
 */
function createFormatCompletion(
  name: string,
  isInput: boolean,
  isOutput: boolean,
): CompletionItem {
  let detail = '(format)';
  if (isInput && isOutput) {
    detail = '(format: input/output)';
  } else if (isInput) {
    detail = '(format: input only)';
  } else if (isOutput) {
    detail = '(format: output only)';
  }

  return {
    label: name,
    kind: CompletionItemKind.Constant,
    detail,
    sortText: `${SortPriority.FORMAT}${name}`,
  };
}

/**
 * Creates a completion item for a table function.
 */
function createTableFunctionCompletion(
  tableFunc: TableFunctionInfo,
  useSnippets: boolean,
): CompletionItem {
  const item: CompletionItem = {
    label: tableFunc.name,
    kind: CompletionItemKind.Function,
    detail: '(table function)',
  };

  // Use snippet format if client supports it, otherwise plain text with parens
  if (useSnippets) {
    item.insertText = `${tableFunc.name}($1)$0`;
    item.insertTextFormat = InsertTextFormat.Snippet;
  } else {
    item.insertText = `${tableFunc.name}()`;
    item.insertTextFormat = InsertTextFormat.PlainText;
  }

  if (tableFunc.description) {
    item.documentation = {
      kind: MarkupKind.Markdown,
      value: tableFunc.description.trim(),
    };
  }

  item.sortText = `${SortPriority.TABLE_FUNCTION}${tableFunc.name}`;

  return item;
}

/**
 * Creates a completion item for a setting.
 */
function createSettingCompletion(
  setting: SettingInfo,
  isMergeTree = false,
): CompletionItem {
  const item: CompletionItem = {
    label: setting.name,
    kind: CompletionItemKind.Property,
    detail: isMergeTree
      ? `(MergeTree setting: ${setting.type})`
      : `(setting: ${setting.type})`,
  };

  if (setting.description) {
    item.documentation = {
      kind: MarkupKind.Markdown,
      value: setting.description.trim(),
    };
  }

  item.sortText = `${SortPriority.SETTING}${setting.name}`;

  return item;
}

/**
 * Generates all completion items from ClickHouse data.
 * Results are cached for performance.
 */
let cachedCompletions: CompletionItem[] | null = null;
let cachedDataVersion: string | null = null;
// Note: cachedUseSnippets is declared with generateCompletionItems for proximity

/**
 * Options for generating completion items.
 */
export interface CompletionOptions {
  /** Whether the client supports snippet format (default: true for backward compat) */
  useSnippets?: boolean;
}

let cachedUseSnippets: boolean | null = null;

export function generateCompletionItems(
  data: ClickHouseData,
  options: CompletionOptions = {},
): CompletionItem[] {
  const useSnippets = options.useSnippets ?? true;

  // Return cached completions if data version and snippet setting match
  if (
    cachedCompletions &&
    cachedDataVersion === data.version &&
    cachedUseSnippets === useSnippets
  ) {
    return cachedCompletions;
  }

  const items: CompletionItem[] = [];

  // Add functions (highest priority - most commonly used)
  for (const func of data.functions) {
    items.push(createFunctionCompletion(func, useSnippets));
  }

  // Add keywords
  for (const keyword of data.keywords) {
    items.push(createKeywordCompletion(keyword));
  }

  // Add data types
  for (const dataType of data.dataTypes) {
    items.push(createDataTypeCompletion(dataType));
  }

  // Add table engines
  for (const engine of data.tableEngines) {
    items.push(createTableEngineCompletion(engine.name));
  }

  // Add formats
  for (const format of data.formats) {
    items.push(
      createFormatCompletion(format.name, format.isInput, format.isOutput),
    );
  }

  // Add table functions
  for (const tableFunc of data.tableFunctions) {
    items.push(createTableFunctionCompletion(tableFunc, useSnippets));
  }

  // Add settings
  for (const setting of data.settings) {
    items.push(createSettingCompletion(setting, false));
  }

  // Add MergeTree settings
  for (const setting of data.mergeTreeSettings) {
    items.push(createSettingCompletion(setting, true));
  }

  // Cache the results
  cachedCompletions = items;
  cachedDataVersion = data.version;
  cachedUseSnippets = useSnippets;

  return items;
}

/**
 * Filters completion items based on the current word prefix.
 * Uses case-insensitive prefix matching.
 */
export function filterCompletions(
  items: CompletionItem[],
  prefix: string,
): CompletionItem[] {
  if (!prefix) {
    return items;
  }

  const lowerPrefix = prefix.toLowerCase();
  return items.filter((item) =>
    item.label.toLowerCase().startsWith(lowerPrefix),
  );
}

/**
 * Clears the completion cache. Useful for testing or when data is reloaded.
 */
export function clearCompletionCache(): void {
  cachedCompletions = null;
  cachedDataVersion = null;
  cachedUseSnippets = null;
}
