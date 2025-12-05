/**
 * Represents a SQL template literal location from .moose/sql-locations.json
 */
export interface SqlLocation {
  id: string;
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  templateText: string;
}

/**
 * The manifest format for .moose/sql-locations.json
 */
export interface SqlLocationManifest {
  version: number;
  sqlLocations: SqlLocation[];
}

/**
 * Parses sql-locations.json content and returns the manifest.
 * Returns empty locations on parse error (graceful degradation).
 */
export function loadSqlLocations(jsonContent: string): SqlLocationManifest {
  try {
    const parsed = JSON.parse(jsonContent);
    return {
      version: parsed.version ?? 1,
      sqlLocations: Array.isArray(parsed.sqlLocations)
        ? parsed.sqlLocations
        : [],
    };
  } catch {
    // Graceful degradation - return empty manifest on parse error
    return {
      version: 1,
      sqlLocations: [],
    };
  }
}

/**
 * Prepares template text for SQL validation by replacing ${...} placeholders
 * with valid SQL identifiers that won't cause parse errors.
 */
export function prepareSqlForValidation(templateText: string): string {
  // Replace ${...} with a placeholder identifier that's valid in SQL
  // Using '_ph_N' pattern to create unique, valid identifiers
  let counter = 0;
  return templateText.replace(/\$\{\.\.\.\}/g, () => {
    counter++;
    return `_ph_${counter}`;
  });
}
