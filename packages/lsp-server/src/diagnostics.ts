import type { ValidationResult } from '@514labs/moose-sql-validator-wasm';
import {
  type Connection,
  type Diagnostic,
  DiagnosticSeverity,
  DiagnosticTag,
  type Range,
} from 'vscode-languageserver/node';
import type { SqlLocation } from './sqlLocations';

export const DEPRECATED_SQL_TAG_MESSAGE =
  "The 'sql' tag is deprecated. Use 'sql.statement' for complete SQL statements or 'sql.fragment' for SQL expressions and conditions.";

export const DEPRECATED_SQL_TAG_SOURCE = 'moose-sql-deprecated';

/**
 * Creates an LSP diagnostic from a SQL validation error for a SqlLocation.
 * This is used for inline sql template literals.
 */
export function createLocationDiagnostic(
  location: SqlLocation,
  validationError: NonNullable<ValidationResult['error']>,
): { uri: string; diagnostic: Diagnostic } {
  const uri = `file://${location.file}`;

  // Convert 1-indexed source positions to 0-indexed LSP positions
  const range: Range = {
    start: {
      line: location.line - 1,
      character: location.column - 1,
    },
    end: {
      line: location.endLine - 1,
      character: location.endColumn - 1,
    },
  };

  const diagnostic: Diagnostic = {
    range,
    severity: DiagnosticSeverity.Error,
    message: `Invalid SQL: ${validationError.message}`,
    source: 'moose-sql',
  };

  return { uri, diagnostic };
}

/**
 * Creates a deprecation hint diagnostic for bare `sql` tag usage.
 */
export function createDeprecationDiagnostic(location: SqlLocation): {
  uri: string;
  diagnostic: Diagnostic;
} {
  const uri = `file://${location.file}`;

  const range: Range = {
    start: {
      line: location.tagLine - 1,
      character: location.tagColumn - 1,
    },
    end: {
      line: location.tagLine - 1,
      character: location.tagEndColumn - 1,
    },
  };

  const diagnostic: Diagnostic = {
    range,
    severity: DiagnosticSeverity.Hint,
    tags: [DiagnosticTag.Deprecated],
    message: DEPRECATED_SQL_TAG_MESSAGE,
    source: DEPRECATED_SQL_TAG_SOURCE,
  };

  return { uri, diagnostic };
}

/**
 * Clears all diagnostics for the workspace
 */
export function clearDiagnostics(
  _connection: Connection,
  _projectRoot: string,
): void {
  // In a real implementation, we'd track which files have diagnostics
  // For now, this is a no-op as we'll republish on each save
}
