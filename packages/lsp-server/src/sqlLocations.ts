/**
 * Which variant of the sql tag was used.
 * - "statement": sql.statement`...` — full SQL statement, validated
 * - "fragment": sql.fragment`...` — SQL expression/clause, not validated
 * - "bare": sql`...` (deprecated) — treated as statement, shown deprecation hint
 */
export type TagKind = 'statement' | 'fragment' | 'bare';

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
  tagKind: TagKind;
  /** 1-based line of the tag identifier (for deprecation diagnostic range) */
  tagLine: number;
  /** 1-based column of the tag identifier start */
  tagColumn: number;
  /** 1-based column of the tag identifier end */
  tagEndColumn: number;
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
