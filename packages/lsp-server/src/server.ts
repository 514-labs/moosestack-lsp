import * as path from 'node:path';
import {
  getCompletions,
  initCompletionData,
  initValidator,
  type CompletionItem as RustCompletionItem,
  validateSql,
} from '@514labs/moose-sql-validator-wasm';
import {
  type CodeAction,
  CodeActionKind,
  type CodeActionParams,
  type CompletionItem,
  CompletionItemKind,
  type CompletionParams,
  createConnection,
  type Hover,
  type HoverParams,
  type InitializeParams,
  type InitializeResult,
  InsertTextFormat,
  ProposedFeatures,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  type ClickHouseData,
  getAvailableVersions,
  loadClickHouseData,
} from './clickhouseData';
import { detectClickHouseVersion } from './clickhouseVersion';
import {
  createFormatSqlEdit,
  findSqlTemplateAtPosition,
  findTemplateNodeById,
} from './codeActions';
// completions.ts still used by tests but server uses Rust completions
import { createLocationDiagnostic } from './diagnostics';
import { createHoverContent, findHoverInfo, getWordAtPosition } from './hover';
import { detectMooseProject } from './projectDetector';
import { shouldValidateFile, validateSqlLocations } from './serverLogic';
import { extractAllSqlLocations, extractSqlLocations } from './sqlExtractor';
import {
  createTypeScriptService,
  type TypeScriptService,
} from './typescriptService';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let mooseProjectRoot: string | null = null;
let tsService: TypeScriptService | null = null;
let clickhouseData: ClickHouseData | null = null;
let clientSupportsSnippets = false;

// Debounce timers for as-you-type validation
const validationTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 300;

/**
 * Validates a document and publishes diagnostics.
 * Uses the TypeScript service to extract SQL locations and validate them.
 */
function validateDocument(document: TextDocument): void {
  if (!tsService?.isHealthy() || !mooseProjectRoot) return;

  const filePath = new URL(document.uri).pathname;
  if (!shouldValidateFile(filePath, mooseProjectRoot)) return;

  connection.console.log(`Validating file: ${filePath}`);

  try {
    // Update TypeScript program with latest content
    tsService.updateFile(filePath, document.getText());

    const sourceFile = tsService.getSourceFile(filePath);
    if (!sourceFile) {
      connection.console.log(`Could not get source file for: ${filePath}`);
      return;
    }

    // Extract SQL locations from this file
    const sqlLocations = extractSqlLocations(
      sourceFile,
      tsService.getTypeChecker(),
    );

    connection.console.log(
      `Found ${sqlLocations.length} SQL templates in ${filePath}`,
    );

    // Validate and collect diagnostics
    const diagnosticsMap = validateSqlLocations(
      sqlLocations,
      validateSql,
      createLocationDiagnostic,
    );

    // Publish diagnostics for this file (empty array clears old diagnostics)
    const diagnostics = diagnosticsMap.get(document.uri) || [];
    connection.sendDiagnostics({ uri: document.uri, diagnostics });

    if (diagnostics.length > 0) {
      connection.console.log(
        `Published ${diagnostics.length} diagnostic(s) for ${filePath}`,
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      connection.console.error(`Error validating SQL: ${error.message}`);
    } else {
      connection.console.error(`Unknown error validating SQL: ${error}`);
    }
  }
}

/**
 * Performs initial full-project scan for SQL templates.
 * Called after TypeScript service is initialized.
 */
function performInitialScan(): void {
  if (!tsService?.isHealthy() || !mooseProjectRoot) return;

  connection.console.log('Running initial SQL validation scan...');

  try {
    const sourceFiles = tsService.getSourceFiles();
    const typeChecker = tsService.getTypeChecker();

    const allLocations = extractAllSqlLocations(sourceFiles, typeChecker);
    connection.console.log(
      `Found ${allLocations.length} SQL templates in ${sourceFiles.length} files`,
    );

    if (allLocations.length === 0) return;

    // Validate all locations
    const diagnosticsMap = validateSqlLocations(
      allLocations,
      validateSql,
      createLocationDiagnostic,
    );

    // Collect all unique file URIs
    const allFileUris = new Set<string>();
    for (const location of allLocations) {
      allFileUris.add(`file://${location.file}`);
    }

    // Publish diagnostics for all files (empty arrays clear old diagnostics)
    for (const uri of allFileUris) {
      const diagnostics = diagnosticsMap.get(uri) || [];
      connection.sendDiagnostics({ uri, diagnostics });
    }

    connection.console.log(
      `Published diagnostics for ${allFileUris.size} files (${diagnosticsMap.size} with errors)`,
    );
  } catch (error) {
    if (error instanceof Error) {
      connection.console.error(`Error in initial scan: ${error.message}`);
    } else {
      connection.console.error(`Unknown error in initial scan: ${error}`);
    }
  }
}

/**
 * Loads ClickHouse completion data and initializes Rust completion engine.
 * Falls back to latest available version if detection fails.
 */
async function loadClickHouseCompletionData(
  projectRoot: string,
): Promise<void> {
  try {
    // Try to detect version from docker-compose
    let version = await detectClickHouseVersion(projectRoot);

    if (version) {
      connection.console.log(`Detected ClickHouse version: ${version}`);
    } else {
      // Fall back to latest available version
      const available = getAvailableVersions();
      if (available.length > 0) {
        version = available[0]; // Already sorted descending
        connection.console.log(
          `No ClickHouse version detected, using latest: ${version}`,
        );
      } else {
        connection.console.warn('No ClickHouse data files available');
        return;
      }
    }

    clickhouseData = await loadClickHouseData(version);

    if (clickhouseData.warning) {
      connection.console.warn(clickhouseData.warning);
    }

    // Initialize Rust completion engine with the data
    const jsonData = JSON.stringify(clickhouseData);
    const initResult = initCompletionData(jsonData);

    if (!initResult.success) {
      connection.console.error(
        `Failed to init completion data: ${initResult.error}`,
      );
      return;
    }

    connection.console.log(
      `Loaded ClickHouse data: ${clickhouseData.functions.length} functions, ${clickhouseData.keywords.length} keywords`,
    );
  } catch (error) {
    if (error instanceof Error) {
      connection.console.error(
        `Failed to load ClickHouse data: ${error.message}`,
      );
    } else {
      connection.console.error(`Failed to load ClickHouse data: ${error}`);
    }
  }
}

connection.onInitialize(
  async (params: InitializeParams): Promise<InitializeResult> => {
    // Check if client supports snippet completions
    clientSupportsSnippets =
      params.capabilities.textDocument?.completion?.completionItem
        ?.snippetSupport ?? false;

    connection.console.log(`Client snippet support: ${clientSupportsSnippets}`);

    const workspaceRoot = params.rootUri
      ? new URL(params.rootUri).pathname
      : null;

    if (workspaceRoot) {
      try {
        mooseProjectRoot = await detectMooseProject(workspaceRoot);
        if (mooseProjectRoot) {
          connection.console.log(
            `Moose project detected at: ${mooseProjectRoot}`,
          );

          // Initialize WASM SQL validator
          await initValidator();

          // Initialize TypeScript service
          const tsconfigPath = path.join(mooseProjectRoot, 'tsconfig.json');
          tsService = createTypeScriptService();
          tsService.initialize(tsconfigPath);

          if (!tsService.isHealthy()) {
            connection.console.error(
              `Failed to initialize TypeScript: ${tsService.getError()}`,
            );
            tsService = null;
          } else {
            connection.console.log('TypeScript service initialized');
            // Perform initial full-project scan
            performInitialScan();
          }

          // Load ClickHouse completion data
          await loadClickHouseCompletionData(mooseProjectRoot);
        } else {
          connection.console.log('No Moose project detected in workspace');
        }
      } catch (error) {
        connection.console.error(`Error detecting Moose project: ${error}`);
      }
    }

    return {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: TextDocumentSyncKind.Full, // Full sync for as-you-type validation
          save: {
            includeText: true,
          },
        },
        codeActionProvider: {
          codeActionKinds: ['source.formatSql'],
        },
        completionProvider: {
          triggerCharacters: ['.', '(', ' '],
          resolveProvider: false,
        },
        hoverProvider: true,
      },
    };
  },
);

/**
 * Schedules a debounced validation for the given document.
 * Cancels any pending validation for the same document.
 */
function scheduleValidation(document: TextDocument): void {
  const uri = document.uri;

  // Cancel any pending validation for this document
  const existingTimer = validationTimers.get(uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule new validation
  const timer = setTimeout(() => {
    validationTimers.delete(uri);
    validateDocument(document);
  }, DEBOUNCE_MS);

  validationTimers.set(uri, timer);
}

// Validate on content change (as-you-type with debouncing)
documents.onDidChangeContent((event) => {
  scheduleValidation(event.document);
});

// Validate immediately on save (cancel any pending debounced validation)
documents.onDidSave((event) => {
  const uri = event.document.uri;
  const existingTimer = validationTimers.get(uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
    validationTimers.delete(uri);
  }
  connection.console.log(`didSave received for: ${uri}`);
  validateDocument(event.document);
});

// Validate on open
documents.onDidOpen((event) => {
  connection.console.log(`didOpen received for: ${event.document.uri}`);
  validateDocument(event.document);
});

// Clean up timers when document is closed
documents.onDidClose((event) => {
  const uri = event.document.uri;
  const existingTimer = validationTimers.get(uri);
  if (existingTimer) {
    clearTimeout(existingTimer);
    validationTimers.delete(uri);
  }
});

// Code action handler - returns available code actions for a given range
connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
  if (!tsService?.isHealthy() || !mooseProjectRoot) return [];

  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const filePath = new URL(params.textDocument.uri).pathname;
  if (!shouldValidateFile(filePath, mooseProjectRoot)) return [];

  try {
    const sourceFile = tsService.getSourceFile(filePath);
    if (!sourceFile) return [];

    const sqlLocations = extractSqlLocations(
      sourceFile,
      tsService.getTypeChecker(),
    );

    // Find if cursor is inside any SQL template
    const location = findSqlTemplateAtPosition(
      sqlLocations,
      params.range.start.line,
      params.range.start.character,
    );

    if (!location) return [];

    // Find the AST node to compute the edit
    const node = findTemplateNodeById(sourceFile, location.id);
    if (!node) return [];

    // Compute the edit directly (don't defer to resolve)
    const edit = createFormatSqlEdit(sourceFile, node);
    if (!edit) return [];

    return [
      {
        title: 'Format SQL',
        kind: `${CodeActionKind.Source}.formatSql`,
        edit: {
          changes: {
            [params.textDocument.uri]: [edit],
          },
        },
      },
    ];
  } catch {
    return [];
  }
});

/**
 * Maps domain-level completion kind from Rust to LSP CompletionItemKind.
 * This maintains the architectural separation: Rust handles SQL domain logic,
 * TypeScript handles LSP protocol mapping.
 */
function mapCompletionItemKind(
  kind: RustCompletionItem['kind'],
): CompletionItemKind {
  switch (kind) {
    case 'function':
      return CompletionItemKind.Function;
    case 'aggregate_function':
      return CompletionItemKind.Method;
    case 'table_function':
      return CompletionItemKind.Function;
    case 'keyword':
      return CompletionItemKind.Keyword;
    case 'data_type':
      return CompletionItemKind.TypeParameter;
    case 'table_engine':
      return CompletionItemKind.Class;
    case 'format':
      return CompletionItemKind.Constant;
    case 'setting':
      return CompletionItemKind.Property;
    default:
      return CompletionItemKind.Text;
  }
}

/**
 * Converts a Rust CompletionItem to an LSP CompletionItem.
 * Handles snippet generation based on hasParams and client capabilities.
 */
function toRustCompletionItem(
  rustItem: RustCompletionItem,
  useSnippets: boolean,
): CompletionItem {
  const kind = mapCompletionItemKind(rustItem.kind);

  // Generate insertText based on hasParams and snippet support
  let insertText: string | undefined;
  let insertTextFormat: InsertTextFormat | undefined;

  if (rustItem.hasParams) {
    if (useSnippets) {
      insertText = `${rustItem.label}($1)$0`;
      insertTextFormat = InsertTextFormat.Snippet;
    } else {
      insertText = `${rustItem.label}()`;
      insertTextFormat = InsertTextFormat.PlainText;
    }
  }

  return {
    label: rustItem.label,
    kind,
    detail: rustItem.detail,
    documentation: rustItem.documentation
      ? { kind: 'markdown' as const, value: rustItem.documentation.value }
      : undefined,
    insertText,
    insertTextFormat,
    sortText: rustItem.sortText,
  };
}

// Completion handler - provides context-aware SQL completions inside sql template literals
connection.onCompletion((params: CompletionParams): CompletionItem[] => {
  if (!tsService?.isHealthy() || !mooseProjectRoot || !clickhouseData) {
    return [];
  }

  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const filePath = new URL(params.textDocument.uri).pathname;
  if (!shouldValidateFile(filePath, mooseProjectRoot)) return [];

  try {
    const sourceFile = tsService.getSourceFile(filePath);
    if (!sourceFile) return [];

    const sqlLocations = extractSqlLocations(
      sourceFile,
      tsService.getTypeChecker(),
    );

    // Check if cursor is inside any SQL template
    const location = findSqlTemplateAtPosition(
      sqlLocations,
      params.position.line,
      params.position.character,
    );

    if (!location) return [];

    // Calculate cursor offset within the SQL template
    const cursorLine = params.position.line;
    const cursorChar = params.position.character;
    const templateStartLine = location.line - 1; // Convert 1-indexed to 0-indexed
    const templateStartChar = location.column - 1;

    // Get the SQL text and calculate offset
    const sqlText = location.templateText;
    let cursorOffset = 0;

    // Count characters from start of template to cursor position
    const lines = sqlText.split('\n');
    const relativeLine = cursorLine - templateStartLine;

    for (let i = 0; i < relativeLine && i < lines.length; i++) {
      cursorOffset += lines[i].length + 1; // +1 for newline
    }

    if (relativeLine === 0) {
      cursorOffset += cursorChar - templateStartChar;
    } else if (relativeLine < lines.length) {
      cursorOffset += cursorChar;
    }

    // Clamp to valid range
    cursorOffset = Math.max(0, Math.min(cursorOffset, sqlText.length));

    // Get context-aware completions from Rust
    const rustCompletions = getCompletions(sqlText, cursorOffset);

    // Get prefix for filtering
    const lineText = document.getText({
      start: { line: params.position.line, character: 0 },
      end: params.position,
    });
    const wordMatch = lineText.match(/[\w]+$/);
    const prefix = wordMatch ? wordMatch[0].toLowerCase() : '';

    // Convert to LSP CompletionItem format and filter by prefix
    const completions: CompletionItem[] = rustCompletions
      .filter((c) => !prefix || c.label.toLowerCase().startsWith(prefix))
      .map((c) => toRustCompletionItem(c, clientSupportsSnippets));

    return completions;
  } catch {
    return [];
  }
});

// Hover handler - provides documentation on hover inside sql template literals
connection.onHover((params: HoverParams): Hover | null => {
  if (!tsService?.isHealthy() || !mooseProjectRoot || !clickhouseData) {
    return null;
  }

  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const filePath = new URL(params.textDocument.uri).pathname;
  if (!shouldValidateFile(filePath, mooseProjectRoot)) return null;

  try {
    const sourceFile = tsService.getSourceFile(filePath);
    if (!sourceFile) return null;

    const sqlLocations = extractSqlLocations(
      sourceFile,
      tsService.getTypeChecker(),
    );

    // Check if cursor is inside any SQL template
    const location = findSqlTemplateAtPosition(
      sqlLocations,
      params.position.line,
      params.position.character,
    );

    if (!location) return null;

    // Get the full line text to extract word at cursor
    const lineText = document.getText({
      start: { line: params.position.line, character: 0 },
      end: { line: params.position.line + 1, character: 0 },
    });

    const word = getWordAtPosition(lineText, params.position.character);
    if (!word) return null;

    // Look up hover info
    const hoverInfo = findHoverInfo(word, clickhouseData);
    if (!hoverInfo) return null;

    return {
      contents: createHoverContent(hoverInfo),
    };
  } catch {
    return null;
  }
});

documents.listen(connection);
connection.listen();
