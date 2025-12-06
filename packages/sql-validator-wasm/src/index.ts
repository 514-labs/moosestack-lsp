export interface ValidationResult {
  valid: boolean;
  error?: {
    message: string;
    line?: number;
    column?: number;
  };
}

export interface FormatResult {
  success: boolean;
  formatted?: string;
  error?: string;
}

export interface InitCompletionResult {
  success: boolean;
  error?: string;
}

/** Domain-level completion item kind from Rust */
export type CompletionItemKind =
  | 'function'
  | 'keyword'
  | 'data_type'
  | 'table_engine'
  | 'format'
  | 'setting'
  | 'aggregate_function'
  | 'table_function';

/** Completion item from Rust - domain data only, no LSP-specific types */
export interface CompletionItem {
  label: string;
  kind: CompletionItemKind;
  detail?: string;
  documentation?: {
    kind: string;
    value: string;
  };
  /** Whether this completion accepts parameters (for functions) */
  hasParams: boolean;
  sortText?: string;
}

// The nodejs target auto-initializes WASM synchronously
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wasmModule = require('../pkg/sql_validator.js');

export async function initValidator(): Promise<void> {
  // No-op - WASM is auto-initialized by the nodejs target
  return Promise.resolve();
}

export function validateSql(sql: string): ValidationResult {
  const resultJson = wasmModule.validate_sql(sql);
  return JSON.parse(resultJson);
}

export function formatSql(sql: string): FormatResult {
  const resultJson = wasmModule.format_sql(sql);
  return JSON.parse(resultJson);
}

export function initCompletionData(json: string): InitCompletionResult {
  const resultJson = wasmModule.init_completion_data(json);
  return JSON.parse(resultJson);
}

export function getCompletions(
  sql: string,
  cursorOffset: number,
): CompletionItem[] {
  const resultJson = wasmModule.get_completions(sql, cursorOffset);
  return JSON.parse(resultJson);
}
