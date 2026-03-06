import ts from 'typescript';
import type { SqlLocation, TagKind } from './sqlLocations';

/**
 * Result of checking whether a tagged template is a moose-lib sql tag.
 * Returns the tag kind if it's a match, or null if not.
 */
type SqlTagMatch = { kind: TagKind } | null;

/**
 * Check if the tag expression originates from @514labs/moose-lib.
 * Resolves the symbol for the root `sql` identifier (works for both
 * `sql` and `sql.statement` / `sql.fragment` since the object is the same import).
 */
function isFromMooseLib(
  identifier: ts.Identifier,
  typeChecker: ts.TypeChecker,
): boolean {
  const symbol = typeChecker.getSymbolAtLocation(identifier);
  if (symbol?.declarations?.length) {
    const isFromLib = symbol.declarations.some((decl) => {
      const fileName = decl.getSourceFile().fileName;
      return (
        fileName.includes('moose-lib') ||
        fileName.includes('@514labs/moose-lib') ||
        fileName.includes('514labs/moose-lib') ||
        fileName.includes('sqlHelpers')
      );
    });
    if (isFromLib) return true;
  }
  // Fallback: if we can't resolve the symbol, assume it's our sql tag
  return true;
}

/**
 * Detect which sql tag variant is used and verify it comes from moose-lib.
 *
 * Matches:
 *   sql`...`           → bare
 *   sql.statement`...` → statement
 *   sql.fragment`...`  → fragment
 */
function matchSqlTag(
  node: ts.TaggedTemplateExpression,
  typeChecker: ts.TypeChecker,
): SqlTagMatch {
  const tag = node.tag;

  // Case 1: bare `sql` identifier
  if (ts.isIdentifier(tag) && tag.text === 'sql') {
    return isFromMooseLib(tag, typeChecker) ? { kind: 'bare' } : null;
  }

  // Case 2: property access `sql.statement` or `sql.fragment`
  if (
    ts.isPropertyAccessExpression(tag) &&
    ts.isIdentifier(tag.expression) &&
    tag.expression.text === 'sql'
  ) {
    const propName = tag.name.text;
    if (propName === 'statement' || propName === 'fragment') {
      return isFromMooseLib(tag.expression, typeChecker)
        ? { kind: propName }
        : null;
    }
  }

  return null;
}

/**
 * Extract template text with ${...} placeholders.
 * Converts template literals like `SELECT ${col} FROM ${table}`
 * into "SELECT ${...} FROM ${...}" for SQL validation.
 */
function extractTemplateText(template: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    return template.text;
  }

  // Template with substitutions: `head ${expr} middle ${expr} tail`
  let text = template.head.text;
  for (const span of template.templateSpans) {
    text += `\${...}${span.literal.text}`;
  }
  return text;
}

/**
 * Get the range of the full tag expression (e.g., `sql` or `sql.statement`).
 * Returns 1-based line/column for the tag (used for deprecation diagnostics).
 */
function getTagRange(
  node: ts.TaggedTemplateExpression,
  sourceFile: ts.SourceFile,
): { tagLine: number; tagColumn: number; tagEndColumn: number } {
  const tagStart = sourceFile.getLineAndCharacterOfPosition(
    node.tag.getStart(),
  );
  const tagEnd = sourceFile.getLineAndCharacterOfPosition(node.tag.getEnd());
  return {
    tagLine: tagStart.line + 1,
    tagColumn: tagStart.character + 1,
    tagEndColumn: tagEnd.character + 1,
  };
}

/**
 * Extract SQL location from a tagged template expression
 */
function extractSqlLocation(
  node: ts.TaggedTemplateExpression,
  sourceFile: ts.SourceFile,
  tagKind: TagKind,
): SqlLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(
    node.template.getStart(),
  );
  const end = sourceFile.getLineAndCharacterOfPosition(node.template.getEnd());
  const { tagLine, tagColumn, tagEndColumn } = getTagRange(node, sourceFile);

  return {
    id: `${sourceFile.fileName}:${start.line + 1}:${start.character + 1}`,
    file: sourceFile.fileName,
    line: start.line + 1, // 1-based
    column: start.character + 1, // 1-based
    endLine: end.line + 1,
    endColumn: end.character + 1,
    templateText: extractTemplateText(node.template),
    tagKind,
    tagLine,
    tagColumn,
    tagEndColumn,
  };
}

/**
 * Extract all SQL locations from a single source file.
 * Uses the TypeChecker to verify that the `sql` tag comes from moose-lib.
 */
export function extractSqlLocations(
  sourceFile: ts.SourceFile,
  typeChecker: ts.TypeChecker,
): SqlLocation[] {
  const locations: SqlLocation[] = [];

  function visit(node: ts.Node): void {
    if (ts.isTaggedTemplateExpression(node)) {
      const match = matchSqlTag(node, typeChecker);
      if (match) {
        locations.push(extractSqlLocation(node, sourceFile, match.kind));
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return locations;
}

/**
 * Extract SQL locations from all source files (for initial scan).
 * Iterates through all source files in the program and collects SQL templates.
 */
export function extractAllSqlLocations(
  sourceFiles: readonly ts.SourceFile[],
  typeChecker: ts.TypeChecker,
): SqlLocation[] {
  const allLocations: SqlLocation[] = [];

  for (const sourceFile of sourceFiles) {
    const locations = extractSqlLocations(sourceFile, typeChecker);
    allLocations.push(...locations);
  }

  return allLocations;
}
