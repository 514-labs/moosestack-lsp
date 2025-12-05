import { formatSql } from '@514labs/moose-sql-validator-wasm';

/**
 * Result of mapping ${...} placeholders to SQL identifiers
 */
export interface PlaceholderMapping {
  /** SQL with ${...} replaced by _ph_N identifiers */
  prepared: string;
  /** Original placeholder strings in order */
  placeholders: string[];
}

/**
 * Maps ${...} placeholders to _ph_N identifiers for SQL parsing.
 * Returns the prepared SQL and the list of original placeholders.
 */
export function mapPlaceholdersToIdentifiers(sql: string): PlaceholderMapping {
  const placeholders: string[] = [];
  let counter = 0;

  const prepared = sql.replace(/\$\{\.\.\.\}/g, () => {
    counter++;
    placeholders.push('${...}');
    return `_ph_${counter}`;
  });

  return { prepared, placeholders };
}

/**
 * Restores original placeholder expressions in formatted SQL.
 * @param formatted - SQL with _ph_N identifiers (case-insensitive)
 * @param originalPlaceholders - Original ${expr} strings to restore
 */
export function restorePlaceholders(
  formatted: string,
  originalPlaceholders: string[],
): string {
  let result = formatted;
  for (let i = 0; i < originalPlaceholders.length; i++) {
    // Use case-insensitive regex since SQL formatter may uppercase identifiers
    const placeholder = new RegExp(`_ph_${i + 1}`, 'i');
    result = result.replace(placeholder, originalPlaceholders[i]);
  }
  return result;
}

/**
 * Result of formatting a SQL template
 */
export interface FormatTemplateResult {
  success: boolean;
  formatted?: string;
  error?: string;
}

/**
 * Formats a SQL template literal, preserving original ${expr} placeholders.
 * @param templateText - SQL with ${...} placeholders (from extractor)
 * @param originalExpressions - Original ${expr} strings to restore after formatting
 */
export function formatSqlTemplate(
  templateText: string,
  originalExpressions: string[],
): FormatTemplateResult {
  // Map placeholders to identifiers
  const { prepared } = mapPlaceholdersToIdentifiers(templateText);

  // Format the SQL
  const formatResult = formatSql(prepared);

  if (!formatResult.success || !formatResult.formatted) {
    return {
      success: false,
      error: formatResult.error ?? 'Unknown formatting error',
    };
  }

  // Restore original placeholders
  const formatted = restorePlaceholders(
    formatResult.formatted,
    originalExpressions,
  );

  return {
    success: true,
    formatted,
  };
}
