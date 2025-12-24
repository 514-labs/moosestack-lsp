import { type MarkupContent, MarkupKind } from 'vscode-languageserver/node';
import type {
  ClickHouseData,
  DataTypeInfo,
  FormatInfo,
  FunctionInfo,
  SettingInfo,
  TableEngineInfo,
  TableFunctionInfo,
} from './clickhouseData';

/**
 * Types of hover information that can be displayed.
 */
export type HoverInfoType =
  | 'function'
  | 'keyword'
  | 'dataType'
  | 'tableEngine'
  | 'format'
  | 'tableFunction'
  | 'setting'
  | 'mergeTreeSetting';

/**
 * Hover information for a ClickHouse element.
 */
export interface HoverInfo {
  type: HoverInfoType;
  name: string;
  data:
    | FunctionInfo
    | DataTypeInfo
    | TableEngineInfo
    | FormatInfo
    | TableFunctionInfo
    | SettingInfo
    | string; // string for keywords
}

/**
 * Extracts the word at the given character position in a line of text.
 * Words consist of alphanumeric characters and underscores.
 *
 * @param text - The line of text
 * @param position - 0-indexed character position
 * @returns The word at the position, or empty string if none
 */
export function getWordAtPosition(text: string, position: number): string {
  if (position < 0 || position > text.length) {
    return '';
  }

  // Find word boundaries
  const wordPattern = /[\w]/;

  // Check if cursor is on a word character or just after one
  const charAtPos = text[position];
  const onWordChar = charAtPos && wordPattern.test(charAtPos);
  const afterWordChar = position > 0 && wordPattern.test(text[position - 1]);

  if (!onWordChar && !afterWordChar) {
    return '';
  }

  // Find start of word
  let start = position;
  while (start > 0 && wordPattern.test(text[start - 1])) {
    start--;
  }

  // Find end of word
  let end = position;
  while (end < text.length && wordPattern.test(text[end])) {
    end++;
  }

  return text.slice(start, end);
}

/**
 * Finds hover information for a word in ClickHouse data.
 * Searches in order: functions, keywords, data types, table functions,
 * settings, MergeTree settings, table engines, formats.
 *
 * @param word - The word to look up
 * @param data - ClickHouse data to search
 * @returns HoverInfo if found, null otherwise
 */
export function findHoverInfo(
  word: string,
  data: ClickHouseData,
): HoverInfo | null {
  const lowerWord = word.toLowerCase();

  // Search functions (case-insensitive, ClickHouse functions are case-insensitive)
  for (const func of data.functions) {
    if (func.name.toLowerCase() === lowerWord) {
      return { type: 'function', name: func.name, data: func };
    }
  }

  // Search keywords (always case-insensitive)
  for (const keyword of data.keywords) {
    if (keyword.toLowerCase() === lowerWord) {
      return { type: 'keyword', name: keyword, data: keyword };
    }
  }

  // Search data types (case-insensitive)
  for (const dt of data.dataTypes) {
    if (dt.name.toLowerCase() === lowerWord) {
      return { type: 'dataType', name: dt.name, data: dt };
    }
  }

  // Search table functions
  for (const tf of data.tableFunctions) {
    if (tf.name.toLowerCase() === lowerWord) {
      return { type: 'tableFunction', name: tf.name, data: tf };
    }
  }

  // Search settings
  for (const setting of data.settings) {
    if (setting.name.toLowerCase() === lowerWord) {
      return { type: 'setting', name: setting.name, data: setting };
    }
  }

  // Search MergeTree settings
  for (const setting of data.mergeTreeSettings) {
    if (setting.name.toLowerCase() === lowerWord) {
      return { type: 'mergeTreeSetting', name: setting.name, data: setting };
    }
  }

  // Search table engines
  for (const engine of data.tableEngines) {
    if (engine.name.toLowerCase() === lowerWord) {
      return { type: 'tableEngine', name: engine.name, data: engine };
    }
  }

  // Search formats
  for (const format of data.formats) {
    if (format.name.toLowerCase() === lowerWord) {
      return { type: 'format', name: format.name, data: format };
    }
  }

  return null;
}

/**
 * Creates markdown hover content from hover info.
 *
 * @param info - The hover information to format
 * @returns MarkupContent with markdown formatting
 */
export function createHoverContent(info: HoverInfo): MarkupContent {
  const parts: string[] = [];

  switch (info.type) {
    case 'function': {
      const func = info.data as FunctionInfo;
      const funcType = func.isAggregate ? 'aggregate function' : 'function';

      if (func.aliasTo) {
        parts.push(`**${func.name}** _(alias for \`${func.aliasTo}\`)_`);
      } else {
        parts.push(`**${func.name}** _(${funcType})_`);
      }

      if (func.syntax) {
        parts.push(`\`\`\`sql\n${func.syntax}\n\`\`\``);
      }

      if (func.description) {
        parts.push(func.description.trim());
      }

      if (func.arguments) {
        parts.push(`**Arguments:**\n${func.arguments.trim()}`);
      }

      if (func.returnedValue) {
        parts.push(`**Returns:**\n${func.returnedValue.trim()}`);
      }

      if (func.categories) {
        parts.push(`**Category:** ${func.categories}`);
      }
      break;
    }

    case 'keyword': {
      const keyword = info.data as string;
      parts.push(`**${keyword}** _(SQL keyword)_`);
      break;
    }

    case 'dataType': {
      const dt = info.data as DataTypeInfo;
      if (dt.aliasTo) {
        parts.push(`**${dt.name}** _(data type, alias for \`${dt.aliasTo}\`)_`);
      } else {
        parts.push(`**${dt.name}** _(data type)_`);
      }
      break;
    }

    case 'tableEngine': {
      const engine = info.data as TableEngineInfo;
      parts.push(`**${engine.name}** _(table engine)_`);

      const features: string[] = [];
      if (engine.supportsReplication) features.push('replication');
      if (engine.supportsTTL) features.push('TTL');
      if (engine.supportsProjections) features.push('projections');
      if (engine.supportsSkippingIndices) features.push('skipping indices');
      if (engine.supportsSortOrder) features.push('sort order');
      if (engine.supportsSettings) features.push('settings');

      if (features.length > 0) {
        parts.push(`**Supports:** ${features.join(', ')}`);
      }
      break;
    }

    case 'format': {
      const format = info.data as FormatInfo;
      const modes: string[] = [];
      if (format.isInput) modes.push('input');
      if (format.isOutput) modes.push('output');
      parts.push(`**${format.name}** _(format: ${modes.join('/')})_`);
      break;
    }

    case 'tableFunction': {
      const tf = info.data as TableFunctionInfo;
      parts.push(`**${tf.name}** _(table function)_`);
      if (tf.description) {
        parts.push(tf.description.trim());
      }
      break;
    }

    case 'setting':
    case 'mergeTreeSetting': {
      const setting = info.data as SettingInfo;
      const settingType =
        info.type === 'mergeTreeSetting' ? 'MergeTree setting' : 'setting';
      parts.push(`**${setting.name}** _(${settingType}: ${setting.type})_`);
      if (setting.description) {
        parts.push(setting.description.trim());
      }
      break;
    }
  }

  return {
    kind: MarkupKind.Markdown,
    value: parts.join('\n\n'),
  };
}
