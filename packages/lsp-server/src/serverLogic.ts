import type { ValidationResult } from '@514labs/moose-sql-validator-wasm';
import type { Diagnostic } from 'vscode-languageserver/node';
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
  return filePath.startsWith(mooseProjectRoot) && filePath.endsWith('.ts');
}

/**
 * Validates SQL from template locations and returns a map of URI -> diagnostics
 * @param sqlLocations - Array of SQL template locations
 * @param validateSql - Function to validate SQL strings
 * @param createDiagnostic - Function to create LSP diagnostics from validation errors
 * @returns Map of file URIs to their diagnostics
 */
export function validateSqlLocations(
  sqlLocations: SqlLocation[],
  validateSql: ValidateSqlFn,
  createDiagnostic: CreateLocationDiagnosticFn,
): Map<string, Diagnostic[]> {
  const diagnosticsMap = new Map<string, Diagnostic[]>();

  for (const location of sqlLocations) {
    // Replace ${...} placeholders with valid SQL identifiers before validation
    const preparedSql = prepareSqlForValidation(location.templateText);
    const result = validateSql(preparedSql);

    if (!result.valid && result.error) {
      const { uri, diagnostic } = createDiagnostic(location, result.error);

      if (!diagnosticsMap.has(uri)) {
        diagnosticsMap.set(uri, []);
      }
      diagnosticsMap.get(uri)?.push(diagnostic);
    }
  }

  return diagnosticsMap;
}
