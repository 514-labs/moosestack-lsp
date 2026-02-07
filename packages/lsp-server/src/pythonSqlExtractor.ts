import * as path from 'node:path';
import {
  Language,
  Parser,
  type Point,
  type Node as SyntaxNode,
} from 'web-tree-sitter';
import type { SqlLocation } from './sqlLocations';

let parser: Parser | null = null;

/**
 * Initialize the web-tree-sitter parser with the Python grammar.
 * Must be called before any extraction functions.
 */
export async function initParser(): Promise<void> {
  if (parser) return;

  await Parser.init();
  const p = new Parser();

  // Load the Python WASM grammar from dist/ (copied during build)
  const wasmPath = path.join(__dirname, 'tree-sitter-python.wasm');
  const Python = await Language.load(wasmPath);
  p.setLanguage(Python);
  parser = p;
}

function getParser(): Parser {
  if (!parser) {
    throw new Error(
      'Parser not initialized. Call initParser() before using extraction functions.',
    );
  }
  return parser;
}

/**
 * Check if the file imports from moose_lib.
 * This is used to filter out sql() calls that aren't from moose-lib.
 */
function fileImportsMooseLib(rootNode: SyntaxNode): boolean {
  for (const child of rootNode.children) {
    if (!child) continue;
    // Handle: import moose_lib
    if (child.type === 'import_statement') {
      const moduleName = child.childForFieldName('name');
      if (moduleName?.text === 'moose_lib') {
        return true;
      }
      // Handle: import moose_lib.sql
      if (
        moduleName?.type === 'dotted_name' &&
        moduleName.text.startsWith('moose_lib')
      ) {
        return true;
      }
    }

    // Handle: from moose_lib import sql
    // Handle: from moose_lib.sql import sql
    if (child.type === 'import_from_statement') {
      const moduleName = child.childForFieldName('module_name');
      if (
        moduleName?.text === 'moose_lib' ||
        moduleName?.text?.startsWith('moose_lib.')
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a function call is a `sql()` call from moose-lib.
 * We look for calls where the function name is 'sql'.
 */
function isSqlFunctionCall(node: SyntaxNode): boolean {
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
function extractSqlFromCall(callNode: SyntaxNode): {
  text: string;
  startPosition: Point;
  endPosition: Point;
} | null {
  const arguments_ = callNode.childForFieldName('arguments');
  if (!arguments_) return null;

  // Get the first argument (the SQL string)
  for (const child of arguments_.children) {
    if (!child) continue;
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
function extractStringContent(node: SyntaxNode): string | null {
  const text = node.text;
  const isFString = /^f['"]/.test(text);

  if (node.type === 'string') {
    if (isFString) {
      // F-string: f"SELECT {col} FROM users"
      return extractFStringContent(text);
    }
    // Regular string: "SELECT * FROM users"
    // Remove quotes and extract content
    return extractQuotedStringContent(text);
  }

  if (node.type === 'formatted_string') {
    // F-string: f"SELECT {col} FROM users"
    return extractFStringContent(text);
  }

  if (node.type === 'concatenated_string') {
    // Handle concatenated strings: "SELECT " "* FROM users"
    let result = '';
    for (const child of node.children) {
      if (!child) continue;
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
 * Extract content from an f-string text, converting interpolations to ${...}.
 * Works with raw text (e.g., f"SELECT {col} FROM users").
 */
function extractFStringContent(text: string): string {
  // Remove the f-string prefix (f", f', f""", f''')
  let content: string;
  if (text.startsWith('f"""') || text.startsWith("f'''")) {
    content = text.slice(4, -3);
  } else if (text.startsWith('f"') || text.startsWith("f'")) {
    content = text.slice(2, -1);
  } else {
    content = text;
  }

  // Replace balanced {expr} with ${...} using depth tracking
  // This handles nested braces like {func({1, 2})} correctly
  let result = '';
  let i = 0;
  while (i < content.length) {
    if (content[i] === '{') {
      if (content[i + 1] === '{') {
        // Escaped {{ → literal {
        result += '{';
        i += 2;
      } else {
        // Find matching closing brace with depth tracking
        let depth = 1;
        let j = i + 1;
        while (j < content.length && depth > 0) {
          if (content[j] === '{') depth++;
          else if (content[j] === '}') depth--;
          j++;
        }
        result += '${...}';
        i = j;
      }
    } else if (content[i] === '}' && content[i + 1] === '}') {
      // Escaped }} → literal }
      result += '}';
      i += 2;
    } else {
      result += content[i];
      i++;
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
function hasColFormatSpecifier(node: SyntaxNode): boolean {
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
  startPosition: Point,
  endPosition: Point,
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

  const tree = getParser().parse(sourceCode);
  if (!tree) return locations;

  // Only process sql() calls if the file imports from moose_lib
  const hasMooseImport = fileImportsMooseLib(tree.rootNode);

  function visit(node: SyntaxNode): void {
    // Check for sql() function calls (only if file imports moose_lib)
    if (hasMooseImport && isSqlFunctionCall(node)) {
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
    // tree-sitter-python may use 'string' or 'formatted_string' for f-strings
    const isFString =
      node.type === 'formatted_string' ||
      (node.type === 'string' && /^f['"]/.test(node.text));

    if (isFString && hasColFormatSpecifier(node)) {
      const content = extractFStringContent(node.text);
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
      if (child) visit(child);
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
