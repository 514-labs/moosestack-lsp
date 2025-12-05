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
