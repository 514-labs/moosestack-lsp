import ts from 'typescript';
import type { SqlLocation, SqlTagKind } from './sqlLocations';

/**
 * Check if the tag is a moose-lib sql tag and determine its kind.
 * Returns the tag kind, or null if it's not a moose-lib sql tag.
 *
 * Handles:
 * - sql`...`           -> 'bare'
 * - sql.statement`...` -> 'statement'
 * - sql.fragment`...`  -> 'fragment'
 */
function getMooseSqlTagKind(
  node: ts.TaggedTemplateExpression,
  typeChecker: ts.TypeChecker,
): SqlTagKind | null {
  const tag = node.tag;

  let sqlIdentifier: ts.Identifier;
  let tagKind: SqlTagKind;

  if (ts.isIdentifier(tag) && tag.text === 'sql') {
    // Bare sql`...`
    sqlIdentifier = tag;
    tagKind = 'bare';
  } else if (
    ts.isPropertyAccessExpression(tag) &&
    ts.isIdentifier(tag.expression) &&
    tag.expression.text === 'sql'
  ) {
    // sql.statement`...` or sql.fragment`...`
    const propName = tag.name.text;
    if (propName === 'statement') {
      tagKind = 'statement';
    } else if (propName === 'fragment') {
      tagKind = 'fragment';
    } else {
      return null;
    }
    sqlIdentifier = tag.expression;
  } else {
    return null;
  }

  // Verify the sql identifier comes from moose-lib
  const symbol = typeChecker.getSymbolAtLocation(sqlIdentifier);
  if (!symbol) {
    // Can't resolve the symbol at all — assume it's our sql tag
    return tagKind;
  }

  // Follow import aliases to the original declaration
  const resolvedSymbol =
    symbol.flags & ts.SymbolFlags.Alias
      ? typeChecker.getAliasedSymbol(symbol)
      : symbol;

  if (resolvedSymbol?.declarations?.length) {
    const isFromMooseLib = resolvedSymbol.declarations.some((decl) => {
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
      return tagKind;
    }
    // Symbol resolved to a non-moose-lib declaration — not our tag
    return null;
  }

  // Fallback: symbol exists but has no declarations — assume it's our sql tag
  return tagKind;
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
  tagKind: SqlTagKind,
): SqlLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(
    node.template.getStart(),
  );
  const end = sourceFile.getLineAndCharacterOfPosition(node.template.getEnd());

  // Tag position: covers `sql`, `sql.statement`, or `sql.fragment`
  const tagStart = sourceFile.getLineAndCharacterOfPosition(
    node.tag.getStart(),
  );
  const tagEnd = sourceFile.getLineAndCharacterOfPosition(node.tag.getEnd());

  return {
    id: `${sourceFile.fileName}:${start.line + 1}:${start.character + 1}`,
    file: sourceFile.fileName,
    line: start.line + 1, // 1-based
    column: start.character + 1, // 1-based
    endLine: end.line + 1,
    endColumn: end.character + 1,
    templateText: extractTemplateText(node.template),
    tagKind,
    tagLine: tagStart.line + 1,
    tagColumn: tagStart.character + 1,
    tagEndColumn: tagEnd.character + 1,
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
      const tagKind = getMooseSqlTagKind(node, typeChecker);
      if (tagKind !== null) {
        locations.push(extractSqlLocation(node, sourceFile, tagKind));
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
