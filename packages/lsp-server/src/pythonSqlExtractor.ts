import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import type { SqlLocation } from './sqlLocations';

// Initialize tree-sitter parser with Python grammar
const parser = new Parser();
// Cast to any to work around type compatibility issues between tree-sitter and tree-sitter-python
parser.setLanguage(Python as unknown as Parser.Language);

/**
 * Check if a function call is a `sql()` call from moose-lib.
 * We look for calls where the function name is 'sql'.
 * Since Python doesn't have the same type resolution as TypeScript,
 * we use a heuristic approach - any `sql()` call is considered valid.
 */
function isSqlFunctionCall(node: Parser.SyntaxNode): boolean {
  if (node.type !== 'call') return false;

  const functionNode = node.childForFieldName('function');
  if (!functionNode) return false;

  // Direct call: sql("...")
  if (functionNode.type === 'identifier' && functionNode.text === 'sql') {
    return true;
  }

  // Attribute access: moose_lib.sql("...") or similar
  if (functionNode.type === 'attribute') {
    const attribute = functionNode.childForFieldName('attribute');
    if (attribute?.text === 'sql') {
      return true;
    }
  }

  return false;
}

/**
 * Extract the SQL string from a sql() function call arguments.
 * Handles both regular strings and f-strings.
 */
function extractSqlFromCall(callNode: Parser.SyntaxNode): {
  text: string;
  startPosition: Parser.Point;
  endPosition: Parser.Point;
} | null {
  const arguments_ = callNode.childForFieldName('arguments');
  if (!arguments_) return null;

  // Get the first argument (the SQL string)
  for (const child of arguments_.children) {
    if (
      child.type === 'string' ||
      child.type === 'concatenated_string' ||
      child.type === 'formatted_string'
    ) {
      const result = extractStringContent(child);
      if (result) {
        return {
          text: result,
          startPosition: child.startPosition,
          endPosition: child.endPosition,
        };
      }
    }
  }

  return null;
}

/**
 * Extract text content from a string node (regular string or f-string).
 * Converts f-string interpolations to ${...} placeholders.
 */
function extractStringContent(node: Parser.SyntaxNode): string | null {
  if (node.type === 'string') {
    // Regular string: "SELECT * FROM users"
    // Remove quotes and extract content
    return extractQuotedStringContent(node.text);
  }

  if (node.type === 'formatted_string') {
    // F-string: f"SELECT {col} FROM users"
    return extractFormattedStringContent(node);
  }

  if (node.type === 'concatenated_string') {
    // Handle concatenated strings: "SELECT " "* FROM users"
    let result = '';
    for (const child of node.children) {
      if (child.type === 'string' || child.type === 'formatted_string') {
        const content = extractStringContent(child);
        if (content !== null) {
          result += content;
        }
      }
    }
    return result || null;
  }

  return null;
}

/**
 * Extract content from a quoted string, removing the quotes.
 */
function extractQuotedStringContent(text: string): string | null {
  // Handle triple-quoted strings
  if (
    text.startsWith('"""') ||
    text.startsWith("'''") ||
    text.startsWith('f"""') ||
    text.startsWith("f'''") ||
    text.startsWith('r"""') ||
    text.startsWith("r'''")
  ) {
    const prefixLen = text.startsWith('f') || text.startsWith('r') ? 4 : 3;
    return text.slice(prefixLen, -3);
  }

  // Handle single/double quoted strings
  if (
    text.startsWith('"') ||
    text.startsWith("'") ||
    text.startsWith('f"') ||
    text.startsWith("f'") ||
    text.startsWith('r"') ||
    text.startsWith("r'")
  ) {
    const prefixLen = text.startsWith('f') || text.startsWith('r') ? 2 : 1;
    return text.slice(prefixLen, -1);
  }

  return text;
}

/**
 * Extract content from a formatted string (f-string).
 * Converts {expr} and {expr:col} to ${...} placeholders.
 */
function extractFormattedStringContent(node: Parser.SyntaxNode): string {
  let result = '';

  for (const child of node.children) {
    if (
      child.type === 'string_content' ||
      child.type === 'string_start' ||
      child.type === 'string_end'
    ) {
      // Regular text content
      if (child.type === 'string_content') {
        result += child.text;
      }
    } else if (child.type === 'interpolation') {
      // {expr} or {expr:format} - convert to ${...}
      result += '${...}';
    } else if (child.type === 'formatted_value') {
      // Alternative name for interpolation in some tree-sitter versions
      result += '${...}';
    }
  }

  return result;
}

/**
 * Check if a string node contains SQL-like content.
 * Used to identify f-strings that might contain SQL even outside sql() calls.
 */
function looksLikeSql(text: string): boolean {
  const sqlKeywords = [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'CREATE',
    'DROP',
    'ALTER',
    'FROM',
    'WHERE',
    'JOIN',
    'TABLE',
    'INDEX',
    'VIEW',
  ];

  const upperText = text.toUpperCase();
  return sqlKeywords.some((keyword) => upperText.includes(keyword));
}

/**
 * Check if a formatted string contains :col format specifier.
 * This is a moose-lib specific pattern for SQL columns.
 */
function hasColFormatSpecifier(node: Parser.SyntaxNode): boolean {
  const text = node.text;
  // Look for patterns like {var:col} or {Model.field:col}
  return /:col\s*\}/.test(text);
}

/**
 * Extract SQL location from a node.
 */
function createSqlLocation(
  filePath: string,
  text: string,
  startPosition: Parser.Point,
  endPosition: Parser.Point,
): SqlLocation {
  return {
    id: `${filePath}:${startPosition.row + 1}:${startPosition.column + 1}`,
    file: filePath,
    line: startPosition.row + 1, // 1-based
    column: startPosition.column + 1, // 1-based
    endLine: endPosition.row + 1,
    endColumn: endPosition.column + 1,
    templateText: text,
  };
}

/**
 * Extract all SQL locations from a Python source file.
 * Finds:
 * 1. sql() function calls with string arguments
 * 2. F-strings with :col format specifiers (moose-lib pattern)
 */
export function extractPythonSqlLocations(
  sourceCode: string,
  filePath: string,
): SqlLocation[] {
  const locations: SqlLocation[] = [];

  const tree = parser.parse(sourceCode);

  function visit(node: Parser.SyntaxNode): void {
    // Check for sql() function calls
    if (isSqlFunctionCall(node)) {
      const sqlContent = extractSqlFromCall(node);
      if (sqlContent) {
        locations.push(
          createSqlLocation(
            filePath,
            sqlContent.text,
            sqlContent.startPosition,
            sqlContent.endPosition,
          ),
        );
      }
    }

    // Check for f-strings with :col format specifier (moose-lib SQL pattern)
    if (node.type === 'formatted_string' && hasColFormatSpecifier(node)) {
      const content = extractFormattedStringContent(node);
      if (content && looksLikeSql(content)) {
        locations.push(
          createSqlLocation(
            filePath,
            content,
            node.startPosition,
            node.endPosition,
          ),
        );
      }
    }

    // Recursively visit children
    for (const child of node.children) {
      visit(child);
    }
  }

  visit(tree.rootNode);
  return locations;
}

/**
 * Extract SQL locations from all provided Python files.
 * Used for initial scan of the project.
 */
export function extractAllPythonSqlLocations(
  files: Array<{ path: string; content: string }>,
): SqlLocation[] {
  const allLocations: SqlLocation[] = [];

  for (const file of files) {
    const locations = extractPythonSqlLocations(file.content, file.path);
    allLocations.push(...locations);
  }

  return allLocations;
}

/**
 * Get the tree-sitter parser instance.
 * Useful for tests or advanced usage.
 */
export function getParser(): Parser {
  return parser;
}
