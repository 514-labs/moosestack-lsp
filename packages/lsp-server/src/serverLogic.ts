import type { ValidationResult } from '@514labs/moose-sql-validator-wasm';
import type { Diagnostic } from 'vscode-languageserver/node';
import { createDeprecationDiagnostic } from './diagnostics';
import { prepareSqlForValidation, type SqlLocation } from './sqlLocations';

/**
 * Function type for SQL validation
 */
export type ValidateSqlFn = (sql: string) => ValidationResult;

/**
 * Function type for creating diagnostics from SqlLocation
 */
export type CreateLocationDiagnosticFn = (
  location: SqlLocation,
  error: NonNullable<ValidationResult['error']>,
) => { uri: string; diagnostic: Diagnostic };

/**
 * Determines if a file should be validated based on path and project root
 * @param filePath - The absolute path to the file
 * @param mooseProjectRoot - The root of the Moose project (or null if not detected)
 * @returns true if the file should be validated
 */
export function shouldValidateFile(
  filePath: string,
  mooseProjectRoot: string | null,
): boolean {
  if (!mooseProjectRoot) return false;
  if (!filePath.startsWith(mooseProjectRoot)) return false;
  return filePath.endsWith('.ts') || filePath.endsWith('.py');
}

/**
 * Determines if a file is a TypeScript file
 */
export function isTypeScriptFile(filePath: string): boolean {
  return filePath.endsWith('.ts') || filePath.endsWith('.tsx');
}

/**
 * Determines if a file is a Python file
 */
export function isPythonFile(filePath: string): boolean {
  return filePath.endsWith('.py');
}

function addDiagnostic(
  map: Map<string, Diagnostic[]>,
  uri: string,
  diagnostic: Diagnostic,
): void {
  if (!map.has(uri)) {
    map.set(uri, []);
  }
  map.get(uri)?.push(diagnostic);
}

/**
 * Validates SQL from template locations and returns a map of URI -> diagnostics.
 * - Fragments (sql.fragment) are skipped for statement-level validation.
 * - Bare sql tags get a deprecation hint diagnostic.
 */
export function validateSqlLocations(
  sqlLocations: SqlLocation[],
  validateSql: ValidateSqlFn,
  createDiagnostic: CreateLocationDiagnosticFn,
): Map<string, Diagnostic[]> {
  const diagnosticsMap = new Map<string, Diagnostic[]>();

  for (const location of sqlLocations) {
    // Emit deprecation hint for bare `sql` tag
    if (location.tagKind === 'bare') {
      const { uri, diagnostic } = createDeprecationDiagnostic(location);
      addDiagnostic(diagnosticsMap, uri, diagnostic);
    }

    // Skip statement-level validation for fragments — they aren't full SQL
    if (location.tagKind === 'fragment') continue;

    // Replace ${...} placeholders with valid SQL identifiers before validation
    const preparedSql = prepareSqlForValidation(location.templateText);
    const result = validateSql(preparedSql);

    if (!result.valid && result.error) {
      const { uri, diagnostic } = createDiagnostic(location, result.error);
      addDiagnostic(diagnosticsMap, uri, diagnostic);
    }
  }

  return diagnosticsMap;
}
