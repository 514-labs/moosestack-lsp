import ts from 'typescript';
import {
  type CodeAction,
  CodeActionKind,
  type Diagnostic,
  type TextEdit,
} from 'vscode-languageserver/node';
import { formatSqlTemplate } from './formatting';
import type { SqlLocation } from './sqlLocations';

/**
 * Finds the SQL template that contains the given cursor position.
 * @param locations - Array of SQL template locations
 * @param line - 0-indexed cursor line
 * @param character - 0-indexed cursor column
 * @returns The SqlLocation containing the cursor, or undefined
 */
export function findSqlTemplateAtPosition(
  locations: SqlLocation[],
  line: number,
  character: number,
): SqlLocation | undefined {
  // Convert to 1-indexed for comparison with SqlLocation
  const cursorLine = line + 1;
  const cursorColumn = character + 1;

  for (const loc of locations) {
    // Check if cursor is within the template bounds
    const afterStart =
      cursorLine > loc.line ||
      (cursorLine === loc.line && cursorColumn >= loc.column);

    const beforeEnd =
      cursorLine < loc.endLine ||
      (cursorLine === loc.endLine && cursorColumn <= loc.endColumn);

    if (afterStart && beforeEnd) {
      return loc;
    }
  }

  return undefined;
}

/**
 * Extract original ${expr} expressions from a template literal.
 * Returns array of expression source texts like ['${col}', '${table}'].
 */
export function extractOriginalExpressions(
  template: ts.TemplateLiteral,
): string[] {
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    return [];
  }

  const expressions: string[] = [];
  for (const span of template.templateSpans) {
    const exprText = span.expression.getText();
    expressions.push(`\${${exprText}}`);
  }
  return expressions;
}

/**
 * Extract template text with ${...} placeholders.
 */
function extractTemplateText(template: ts.TemplateLiteral): string {
  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    return template.text;
  }

  let text = template.head.text;
  for (const span of template.templateSpans) {
    text += `\${...}${span.literal.text}`;
  }
  return text;
}

/**
 * Detects the indentation used in the original template.
 * Returns the indentation string (spaces/tabs) and whether it starts with a newline.
 */
function detectTemplateIndentation(templateText: string): {
  indent: string;
  hasLeadingNewline: boolean;
  hasTrailingNewline: boolean;
  trailingIndent: string;
} {
  const hasLeadingNewline = templateText.startsWith('\n');
  const hasTrailingNewline =
    templateText.endsWith('\n') || /\n\s*$/.test(templateText);

  // Find indentation from the first non-empty line after the opening
  let indent = '';
  if (hasLeadingNewline) {
    const lines = templateText.split('\n');
    // Find first line with actual content (skip empty lines)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length > 0) {
        const match = line.match(/^(\s*)/);
        if (match) {
          indent = match[1];
        }
        break;
      }
    }
  }

  // Find trailing indentation (indentation of the closing backtick line)
  let trailingIndent = '';
  if (hasTrailingNewline) {
    const match = templateText.match(/\n(\s*)$/);
    if (match) {
      trailingIndent = match[1];
    }
  }

  return { indent, hasLeadingNewline, hasTrailingNewline, trailingIndent };
}

/**
 * Applies indentation to formatted SQL, preserving the original template structure.
 */
function applyIndentation(
  formatted: string,
  indent: string,
  hasLeadingNewline: boolean,
  hasTrailingNewline: boolean,
  trailingIndent: string,
): string {
  // Split formatted SQL into lines and apply indentation
  const lines = formatted.split('\n');
  const indentedLines = lines.map((line) =>
    line.length > 0 ? indent + line : line,
  );

  let result = indentedLines.join('\n');

  // Add leading newline if original had one
  if (hasLeadingNewline) {
    result = `\n${result}`;
  }

  // Add trailing newline and indentation if original had it
  if (hasTrailingNewline) {
    result = `${result}\n${trailingIndent}`;
  }

  return result;
}

/**
 * Creates the text edit for formatting a SQL template.
 */
export function createFormatSqlEdit(
  sourceFile: ts.SourceFile,
  node: ts.TaggedTemplateExpression,
): TextEdit | undefined {
  const originalExprs = extractOriginalExpressions(node.template);
  const templateText = extractTemplateText(node.template);

  const result = formatSqlTemplate(templateText, originalExprs);
  if (!result.success || !result.formatted) {
    return undefined;
  }

  // Detect indentation from original template
  const { indent, hasLeadingNewline, hasTrailingNewline, trailingIndent } =
    detectTemplateIndentation(templateText);

  // Apply indentation to formatted SQL
  const formattedWithIndent = applyIndentation(
    result.formatted,
    indent,
    hasLeadingNewline,
    hasTrailingNewline,
    trailingIndent,
  );

  // Get positions inside the backticks
  const templateStart = sourceFile.getLineAndCharacterOfPosition(
    node.template.getStart() + 1,
  );
  const templateEnd = sourceFile.getLineAndCharacterOfPosition(
    node.template.getEnd() - 1,
  );

  return {
    range: {
      start: { line: templateStart.line, character: templateStart.character },
      end: { line: templateEnd.line, character: templateEnd.character },
    },
    newText: formattedWithIndent,
  };
}

/**
 * Finds a TaggedTemplateExpression by its location ID.
 */
export function findTemplateNodeById(
  sourceFile: ts.SourceFile,
  locationId: string,
): ts.TaggedTemplateExpression | undefined {
  let targetNode: ts.TaggedTemplateExpression | undefined;

  function isSqlTag(tag: ts.Expression): boolean {
    if (ts.isIdentifier(tag) && tag.text === 'sql') return true;
    if (
      ts.isPropertyAccessExpression(tag) &&
      ts.isIdentifier(tag.expression) &&
      tag.expression.text === 'sql' &&
      (tag.name.text === 'statement' || tag.name.text === 'fragment')
    ) {
      return true;
    }
    return false;
  }

  function visit(node: ts.Node): void {
    if (ts.isTaggedTemplateExpression(node) && isSqlTag(node.tag)) {
      const start = sourceFile.getLineAndCharacterOfPosition(
        node.template.getStart(),
      );
      const id = `${sourceFile.fileName}:${start.line + 1}:${start.character + 1}`;
      if (id === locationId) {
        targetNode = node;
      }
    }
    if (!targetNode) {
      ts.forEachChild(node, visit);
    }
  }

  visit(sourceFile);
  return targetNode;
}

/**
 * Creates quick-fix code actions for deprecated bare `sql` tag diagnostics.
 * Offers "Convert to sql.statement" and "Convert to sql.fragment".
 */
export function createDeprecationCodeActions(
  uri: string,
  diagnostics: Diagnostic[],
): CodeAction[] {
  const actions: CodeAction[] = [];

  for (const diagnostic of diagnostics) {
    const data = diagnostic.data as { type?: string } | undefined;
    if (data?.type !== 'deprecated-sql-tag') continue;

    actions.push(
      {
        title: "Convert to 'sql.statement'",
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [uri]: [
              {
                range: diagnostic.range,
                newText: 'sql.statement',
              },
            ],
          },
        },
      },
      {
        title: "Convert to 'sql.fragment'",
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [uri]: [
              {
                range: diagnostic.range,
                newText: 'sql.fragment',
              },
            ],
          },
        },
      },
    );
  }

  return actions;
}
