import type { ValidationResult } from '@514labs/moose-sql-validator-wasm';
import {
  type Connection,
  type Diagnostic,
  DiagnosticSeverity,
  type Range,
} from 'vscode-languageserver/node';
import type { SqlLocation } from './sqlLocations';

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
 * Clears all diagnostics for the workspace
 */
export function clearDiagnostics(
  _connection: Connection,
  _projectRoot: string,
): void {
  // In a real implementation, we'd track which files have diagnostics
  // For now, this is a no-op as we'll republish on each save
}
