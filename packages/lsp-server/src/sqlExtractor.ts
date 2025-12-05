import ts from 'typescript';
import type { SqlLocation } from './sqlLocations';

/**
 * Check if the sql tag comes from @514labs/moose-lib.
 * Falls back to returning true if symbol can't be resolved
 * (better to have false positives than miss real sql queries).
 */
function isMooseLibSqlTag(
  node: ts.TaggedTemplateExpression,
  typeChecker: ts.TypeChecker,
): boolean {
  const tag = node.tag;

  // Must be a simple identifier `sql`
  if (!ts.isIdentifier(tag) || tag.text !== 'sql') {
    return false;
  }

  const symbol = typeChecker.getSymbolAtLocation(tag);
  if (symbol?.declarations?.length) {
    // Check if any declaration originates from moose-lib
    const isFromMooseLib = symbol.declarations.some((decl) => {
      const sourceFile = decl.getSourceFile();
      const fileName = sourceFile.fileName;
      return (
        fileName.includes('moose-lib') ||
        fileName.includes('@514labs/moose-lib') ||
        fileName.includes('514labs/moose-lib') ||
        fileName.includes('sqlHelpers')
      );
    });
    if (isFromMooseLib) {
      return true;
    }
  }

  // Fallback: if we can't resolve the symbol, assume it's our sql tag
  // (better to have false positives than miss real sql queries)
  return true;
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
 * Extract SQL location from a tagged template expression
 */
function extractSqlLocation(
  node: ts.TaggedTemplateExpression,
  sourceFile: ts.SourceFile,
): SqlLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(
    node.template.getStart(),
  );
  const end = sourceFile.getLineAndCharacterOfPosition(node.template.getEnd());

  return {
    id: `${sourceFile.fileName}:${start.line + 1}:${start.character + 1}`,
    file: sourceFile.fileName,
    line: start.line + 1, // 1-based
    column: start.character + 1, // 1-based
    endLine: end.line + 1,
    endColumn: end.character + 1,
    templateText: extractTemplateText(node.template),
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
    if (
      ts.isTaggedTemplateExpression(node) &&
      isMooseLibSqlTag(node, typeChecker)
    ) {
      locations.push(extractSqlLocation(node, sourceFile));
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
