import assert from 'node:assert';
import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, test } from 'node:test';

// ---------------------------------------------------------------------------
// LSP message types
// ---------------------------------------------------------------------------

interface LspMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: number;
  message: string;
  source?: string;
}

interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: { kind: string; value: string } | string;
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
}

// LSP CompletionItemKind constants
const CompletionItemKind = {
  Function: 3,
  Keyword: 14,
  TypeParameter: 25,
  Class: 7,
  Constant: 21,
  Property: 10,
  Method: 2,
} as const;

// ---------------------------------------------------------------------------
// LspClient — improved with Buffer-based parsing and concurrent request support
// ---------------------------------------------------------------------------

class LspClient {
  private process: ChildProcess;
  private buffer = Buffer.alloc(0);
  private messages: LspMessage[] = [];
  private nextId = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (msg: LspMessage) => void; reject: (err: Error) => void }
  >();
  private notificationListeners: Array<(msg: LspMessage) => void> = [];
  private stderrChunks: string[] = [];

  constructor(serverPath: string) {
    this.process = spawn('node', [serverPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.parseMessages();
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.stderrChunks.push(data.toString());
    });
  }

  private parseMessages() {
    while (true) {
      const headerEndIndex = this.buffer.indexOf('\r\n\r\n');
      if (headerEndIndex === -1) break;

      const headerStr = this.buffer
        .subarray(0, headerEndIndex)
        .toString('utf-8');
      const match = headerStr.match(/Content-Length: (\d+)/);
      if (!match) break;

      const contentLength = parseInt(match[1], 10);
      const contentStart = headerEndIndex + 4;
      const contentEnd = contentStart + contentLength;

      if (this.buffer.length < contentEnd) break;

      const content = this.buffer
        .subarray(contentStart, contentEnd)
        .toString('utf-8');
      this.buffer = this.buffer.subarray(contentEnd);

      const message = JSON.parse(content) as LspMessage;
      this.messages.push(message);

      // Resolve pending request if this is a response
      if (message.id !== undefined) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);
          pending.resolve(message);
        }
      }

      // Notify listeners for server-initiated messages (notifications)
      if (message.method && message.id === undefined) {
        for (const listener of this.notificationListeners) {
          listener(message);
        }
      }
    }
  }

  send(message: LspMessage): void {
    const content = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
    this.process.stdin?.write(header + content);
  }

  async request(
    method: string,
    params: unknown,
    timeoutMs = 10000,
  ): Promise<LspMessage> {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(`Timeout waiting for response to ${method} (id=${id})`),
        );
      }, timeoutMs);

      // Check if response already arrived
      const existing = this.messages.find((m) => m.id === id);
      if (existing) {
        clearTimeout(timeout);
        resolve(existing);
        return;
      }

      this.pendingRequests.set(id, {
        resolve: (msg) => {
          clearTimeout(timeout);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  openDocument(uri: string, languageId: string, text: string): void {
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  changeDocument(uri: string, version: number, text: string): void {
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  saveDocument(uri: string): void {
    this.notify('textDocument/didSave', {
      textDocument: { uri },
    });
  }

  waitForDiagnostics(uri: string, timeoutMs = 10000): Promise<LspDiagnostic[]> {
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for diagnostics for ${uri}`));
      }, timeoutMs);

      const listener = (msg: LspMessage) => {
        if (msg.method !== 'textDocument/publishDiagnostics') return;
        const params = msg.params as {
          uri: string;
          diagnostics: LspDiagnostic[];
        };
        if (params.uri === uri) {
          cleanup();
          resolve(params.diagnostics);
        }
      };

      const cleanup = () => {
        clearTimeout(deadline);
        const idx = this.notificationListeners.indexOf(listener);
        if (idx !== -1) this.notificationListeners.splice(idx, 1);
      };

      // Check messages already received
      for (let i = this.messages.length - 1; i >= 0; i--) {
        const m = this.messages[i];
        if (m.method === 'textDocument/publishDiagnostics') {
          const params = m.params as {
            uri: string;
            diagnostics: LspDiagnostic[];
          };
          if (params.uri === uri) {
            clearTimeout(deadline);
            resolve(params.diagnostics);
            return;
          }
        }
      }

      this.notificationListeners.push(listener);
    });
  }

  /**
   * Waits for fresh diagnostics that arrive after this call.
   * Ignores any diagnostics already in the message buffer.
   */
  waitForFreshDiagnostics(
    uri: string,
    timeoutMs = 10000,
  ): Promise<LspDiagnostic[]> {
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for fresh diagnostics for ${uri}`));
      }, timeoutMs);

      const listener = (msg: LspMessage) => {
        if (msg.method !== 'textDocument/publishDiagnostics') return;
        const params = msg.params as {
          uri: string;
          diagnostics: LspDiagnostic[];
        };
        if (params.uri === uri) {
          cleanup();
          resolve(params.diagnostics);
        }
      };

      const cleanup = () => {
        clearTimeout(deadline);
        const idx = this.notificationListeners.indexOf(listener);
        if (idx !== -1) this.notificationListeners.splice(idx, 1);
      };

      this.notificationListeners.push(listener);
    });
  }

  getMessages(): LspMessage[] {
    return [...this.messages];
  }

  getStderr(): string {
    return this.stderrChunks.join('');
  }

  getLogMessages(): string[] {
    return this.messages
      .filter((m) => m.method === 'window/logMessage')
      .map((m) => (m.params as { message: string }).message);
  }

  close(): void {
    this.process.kill();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const serverPath = path.join(__dirname, '..', 'dist', 'server.js');

/**
 * Given file content and a search string, returns the 0-indexed
 * line/character position immediately after the last character of the match.
 */
function cursorAfter(
  fileContent: string,
  searchText: string,
): { line: number; character: number } {
  const idx = fileContent.indexOf(searchText);
  if (idx === -1) {
    throw new Error(`cursorAfter: "${searchText}" not found in content`);
  }
  const endIdx = idx + searchText.length;
  const before = fileContent.slice(0, endIdx);
  const lines = before.split('\n');
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}

async function initializeClient(
  client: LspClient,
  rootUri: string,
  snippetSupport = true,
): Promise<LspMessage> {
  const response = await client.request('initialize', {
    processId: null,
    rootUri,
    capabilities: {
      textDocument: {
        completion: {
          completionItem: {
            snippetSupport,
          },
        },
        synchronization: {
          didSave: true,
        },
      },
    },
  });
  client.notify('initialized', {});
  // Give the server a moment to finish async init (WASM, TS service, CH data)
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return response;
}

// ---------------------------------------------------------------------------
// Fixture: TypeScript project
// ---------------------------------------------------------------------------

const TS_TEST_FILE_CONTENT = `import { sql } from '@514labs/moose-lib';

// Valid SQL — should produce no diagnostics
const valid = sql\`SELECT count() FROM users\`;

// Invalid SQL — should produce an error diagnostic
const invalid = sql\`SELCT * FROM users\`;

// Completions: default context (cursor after "SELECT ")
const comp1 = sql\`SELECT \`;

// Context-aware: ENGINE =
const engine = sql\`CREATE TABLE t ENGINE = \`;

// Context-aware: FORMAT
const format = sql\`SELECT * FORMAT \`;

// Context-aware: SETTINGS
const settings = sql\`SELECT * SETTINGS \`;

// Context-aware: column definition (data types)
const coldef = sql\`CREATE TABLE t (id \`;

// Context-aware: FROM (table functions)
const fromCtx = sql\`SELECT * FROM \`;

// Hover targets
const hover = sql\`SELECT count() FROM users WHERE toUInt32(id) > 0\`;

// Format SQL target (lowercase)
const fmt = sql\`select * from users where id = 1\`;

// Combinators
const comb = sql\`SELECT sumIf(amount, active), countIf(status) FROM orders\`;

// Prefix filtering
const prefix = sql\`SELECT cou\`;

// Combinator prefix filtering
const combPrefix = sql\`SELECT sum\`;

// Default context (empty SQL — triggers Default completions with all kinds)
const defaultCtx = sql\`\`;
`;

async function createTsFixture(): Promise<string> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'moose-lsp-integ-ts-'),
  );

  // package.json
  await fs.writeFile(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      name: 'test-moose-ts',
      dependencies: { '@514labs/moose-lib': '*' },
    }),
  );

  // tsconfig.json
  await fs.writeFile(
    path.join(tmpDir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
        strict: true,
        esModuleInterop: true,
        moduleResolution: 'node',
      },
      include: ['app/**/*.ts'],
    }),
  );

  // Minimal moose-lib shim
  const mooseLibDir = path.join(
    tmpDir,
    'node_modules',
    '@514labs',
    'moose-lib',
  );
  await fs.mkdir(mooseLibDir, { recursive: true });
  await fs.writeFile(
    path.join(mooseLibDir, 'package.json'),
    JSON.stringify({
      name: '@514labs/moose-lib',
      main: 'index.js',
      types: 'index.d.ts',
    }),
  );
  await fs.writeFile(
    path.join(mooseLibDir, 'index.js'),
    'module.exports.sql = function sql() { return ""; };\n',
  );
  await fs.writeFile(
    path.join(mooseLibDir, 'index.d.ts'),
    'export declare function sql(strings: TemplateStringsArray, ...values: unknown[]): string;\n',
  );

  // Test TypeScript file
  const appDir = path.join(tmpDir, 'app');
  await fs.mkdir(appDir, { recursive: true });
  await fs.writeFile(path.join(appDir, 'test.ts'), TS_TEST_FILE_CONTENT);

  return tmpDir;
}

// ---------------------------------------------------------------------------
// Fixture: Python project
// ---------------------------------------------------------------------------

const PY_TEST_FILE_CONTENT = `from moose_lib import sql

# Invalid SQL
query = sql("SELCT * FROM users")
`;

async function createPyFixture(): Promise<string> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'moose-lsp-integ-py-'),
  );

  await fs.writeFile(
    path.join(tmpDir, 'pyproject.toml'),
    `[project]\nname = "test-moose-py"\ndependencies = ["moose-lib"]\n`,
  );

  const appDir = path.join(tmpDir, 'app');
  await fs.mkdir(appDir, { recursive: true });
  await fs.writeFile(path.join(appDir, 'test.py'), PY_TEST_FILE_CONTENT);

  return tmpDir;
}

// ---------------------------------------------------------------------------
// Fixture: TypeScript project with docker-compose (version detection)
// ---------------------------------------------------------------------------

async function createTsFixtureWithDockerCompose(
  chVersion: string,
): Promise<string> {
  const tmpDir = await createTsFixture();

  await fs.writeFile(
    path.join(tmpDir, 'docker-compose.dev.override.yaml'),
    `services:\n  clickhousedb:\n    image: clickhouse/clickhouse-server:${chVersion}\n`,
  );

  return tmpDir;
}

// ===========================================================================
// TEST SUITES
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. TypeScript features (single server)
// ---------------------------------------------------------------------------

describe('TypeScript LSP features', () => {
  let client: LspClient;
  let tmpDir: string;
  const tsFileUri = () => `file://${path.join(tmpDir, 'app', 'test.ts')}`;

  before(async () => {
    tmpDir = await createTsFixture();
    client = new LspClient(serverPath);
    await initializeClient(client, `file://${tmpDir}`);
    // Open the test file — triggers initial validation
    client.openDocument(tsFileUri(), 'typescript', TS_TEST_FILE_CONTENT);
    // Wait for the initial diagnostics to arrive
    await client.waitForDiagnostics(tsFileUri());
  });

  after(async () => {
    client.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ---- Feature 1: Error Diagnostics ----

  test('valid SQL produces no error diagnostics on that template', async () => {
    // The server publishes diagnostics for the whole file.
    // We check that the "valid" template line has no diagnostic.
    const validLine = TS_TEST_FILE_CONTENT.split('\n').findIndex((l) =>
      l.includes('const valid'),
    );
    const diagnostics = await client.waitForDiagnostics(tsFileUri());
    const onValidLine = diagnostics.filter(
      (d) => d.range.start.line === validLine,
    );
    assert.strictEqual(
      onValidLine.length,
      0,
      `Expected no diagnostics on the valid SQL line, got: ${JSON.stringify(onValidLine)}`,
    );
  });

  test('invalid SQL produces an error diagnostic', async () => {
    const diagnostics = await client.waitForDiagnostics(tsFileUri());
    const invalidLine = TS_TEST_FILE_CONTENT.split('\n').findIndex((l) =>
      l.includes('const invalid'),
    );
    const onInvalidLine = diagnostics.filter(
      (d) => d.range.start.line === invalidLine,
    );
    assert.ok(
      onInvalidLine.length > 0,
      `Expected at least one diagnostic on the invalid SQL line (${invalidLine})`,
    );
    const diag = onInvalidLine[0];
    assert.strictEqual(diag.severity, 1, 'Severity should be Error (1)');
    assert.strictEqual(diag.source, 'moose-sql');
  });

  test('fixing SQL clears diagnostic on that line', async () => {
    const invalidLine = TS_TEST_FILE_CONTENT.split('\n').findIndex((l) =>
      l.includes('const invalid'),
    );

    const fixedContent = TS_TEST_FILE_CONTENT.replace(
      'SELCT * FROM users',
      'SELECT * FROM users',
    );

    // Send the change, wait for TextDocuments to process it, then save
    client.changeDocument(tsFileUri(), 2, fixedContent);
    await new Promise((r) => setTimeout(r, 100));
    client.saveDocument(tsFileUri());

    // Wait for diagnostics that no longer contain the SELCT error
    const deadline = Date.now() + 10000;
    let lastDiagnostics: LspDiagnostic[] = [];
    while (Date.now() < deadline) {
      lastDiagnostics = await client.waitForFreshDiagnostics(tsFileUri());
      const onFixedLine = lastDiagnostics.filter(
        (d) => d.range.start.line === invalidLine && d.source === 'moose-sql',
      );
      if (onFixedLine.length === 0) break;
      // Got stale diagnostics, wait for the next publish
    }

    const onFixedLine = lastDiagnostics.filter(
      (d) => d.range.start.line === invalidLine && d.source === 'moose-sql',
    );
    assert.strictEqual(
      onFixedLine.length,
      0,
      `Expected no diagnostic on the fixed line (${invalidLine}), got: ${JSON.stringify(onFixedLine)}`,
    );

    // Restore original content for subsequent tests
    client.changeDocument(tsFileUri(), 3, TS_TEST_FILE_CONTENT);
    await new Promise((r) => setTimeout(r, 100));
    client.saveDocument(tsFileUri());
    await client.waitForFreshDiagnostics(tsFileUri());
  });

  // ---- Feature 2: Auto-Complete ----

  test('completions inside SQL template returns items', async () => {
    const pos = cursorAfter(TS_TEST_FILE_CONTENT, 'comp1 = sql`SELECT ');
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    assert.ok(Array.isArray(items), 'Result should be an array');
    assert.ok(items.length > 0, 'Should have completion items');
  });

  test('SelectClause context returns only functions', async () => {
    const pos = cursorAfter(TS_TEST_FILE_CONTENT, 'comp1 = sql`SELECT ');
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    const kinds = new Set(items.map((i) => i.kind));
    assert.ok(
      kinds.has(CompletionItemKind.Function) ||
        kinds.has(CompletionItemKind.Method),
      'Should include function or method completions',
    );
    // SelectClause context only returns functions (no keywords, data types, etc.)
    for (const item of items) {
      assert.ok(
        item.kind === CompletionItemKind.Function ||
          item.kind === CompletionItemKind.Method,
        `SelectClause should only have functions, got kind=${item.kind} for "${item.label}"`,
      );
    }
  });

  test('completions outside SQL template returns empty', async () => {
    // Line 0 is the import line — outside any sql template
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: { line: 0, character: 5 },
    });
    const items = response.result as LspCompletionItem[];
    assert.ok(Array.isArray(items), 'Result should be an array');
    assert.strictEqual(
      items.length,
      0,
      'Should have no completions outside template',
    );
  });

  test('prefix filtering narrows completions', async () => {
    const pos = cursorAfter(TS_TEST_FILE_CONTENT, 'prefix = sql`SELECT cou');
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    assert.ok(items.length > 0, 'Should have some completions');
    const labels = items.map((i) => i.label.toLowerCase());
    assert.ok(
      labels.some((l) => l.startsWith('count')),
      `Should include count*, got: ${labels.slice(0, 10).join(', ')}`,
    );
    // Every item should start with 'cou'
    for (const item of items) {
      assert.ok(
        item.label.toLowerCase().startsWith('cou'),
        `Item "${item.label}" should start with "cou"`,
      );
    }
  });

  // ---- Feature 3: Context-Aware Completions ----

  test('ENGINE = context returns table engines', async () => {
    const pos = cursorAfter(
      TS_TEST_FILE_CONTENT,
      'engine = sql`CREATE TABLE t ENGINE = ',
    );
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    assert.ok(items.length > 0, 'Should have engine completions');
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.some((l) => l === 'MergeTree'),
      `Should include MergeTree, got: ${labels.slice(0, 10).join(', ')}`,
    );
    // All items should be engines (Class kind)
    for (const item of items) {
      assert.strictEqual(
        item.kind,
        CompletionItemKind.Class,
        `Engine item "${item.label}" should have kind=Class(${CompletionItemKind.Class}), got ${item.kind}`,
      );
    }
  });

  test('FORMAT context returns formats', async () => {
    const pos = cursorAfter(
      TS_TEST_FILE_CONTENT,
      'format = sql`SELECT * FORMAT ',
    );
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    assert.ok(items.length > 0, 'Should have format completions');
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.some((l) => l === 'JSON'),
      `Should include JSON, got: ${labels.slice(0, 10).join(', ')}`,
    );
    for (const item of items) {
      assert.strictEqual(
        item.kind,
        CompletionItemKind.Constant,
        `Format item "${item.label}" should have kind=Constant(${CompletionItemKind.Constant}), got ${item.kind}`,
      );
    }
  });

  test('SETTINGS context returns settings', async () => {
    const pos = cursorAfter(
      TS_TEST_FILE_CONTENT,
      'settings = sql`SELECT * SETTINGS ',
    );
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    assert.ok(items.length > 0, 'Should have settings completions');
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.some((l) => l === 'max_threads'),
      `Should include max_threads, got: ${labels.slice(0, 15).join(', ')}`,
    );
    for (const item of items) {
      assert.strictEqual(
        item.kind,
        CompletionItemKind.Property,
        `Setting item "${item.label}" should have kind=Property(${CompletionItemKind.Property}), got ${item.kind}`,
      );
    }
  });

  test('column definition context returns data types', async () => {
    const pos = cursorAfter(
      TS_TEST_FILE_CONTENT,
      'coldef = sql`CREATE TABLE t (id ',
    );
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    assert.ok(items.length > 0, 'Should have data type completions');
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.some((l) => l === 'UInt64'),
      `Should include UInt64, got: ${labels.slice(0, 15).join(', ')}`,
    );
    assert.ok(
      labels.some((l) => l === 'String'),
      `Should include String, got: ${labels.slice(0, 15).join(', ')}`,
    );
  });

  test('FROM context returns table functions', async () => {
    const pos = cursorAfter(
      TS_TEST_FILE_CONTENT,
      'fromCtx = sql`SELECT * FROM ',
    );
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    assert.ok(items.length > 0, 'Should have FROM completions');
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.some((l) => l === 'file' || l === 'url'),
      `Should include table functions like file/url, got: ${labels.slice(0, 15).join(', ')}`,
    );
  });

  // ---- Feature 4: Hover Documentation ----

  test('hover on known function shows documentation', async () => {
    // Find "count" in the hover line
    const hoverLine = TS_TEST_FILE_CONTENT.split('\n').findIndex((l) =>
      l.includes('sql`SELECT count()'),
    );
    // "count" starts after "SELECT "
    const lineText = TS_TEST_FILE_CONTENT.split('\n')[hoverLine];
    const countCharIdx = lineText.indexOf('count');
    assert.ok(countCharIdx !== -1, 'Should find count in hover line');

    const response = await client.request('textDocument/hover', {
      textDocument: { uri: tsFileUri() },
      position: { line: hoverLine, character: countCharIdx + 1 },
    });
    assert.ok(response.result, 'Hover should return a result for count');
    const hover = response.result as {
      contents: { kind: string; value: string };
    };
    assert.ok(
      hover.contents.value.length > 0,
      'Hover content should not be empty',
    );
    assert.strictEqual(
      hover.contents.kind,
      'markdown',
      'Hover should be markdown',
    );
  });

  test('hover on keyword shows documentation', async () => {
    // Hover over SELECT on the hover line
    const hoverLine = TS_TEST_FILE_CONTENT.split('\n').findIndex((l) =>
      l.includes('sql`SELECT count()'),
    );
    const lineText = TS_TEST_FILE_CONTENT.split('\n')[hoverLine];
    const selectIdx = lineText.indexOf('SELECT');

    const response = await client.request('textDocument/hover', {
      textDocument: { uri: tsFileUri() },
      position: { line: hoverLine, character: selectIdx + 1 },
    });
    assert.ok(
      response.result,
      'Hover should return a result for SELECT keyword',
    );
  });

  test('hover outside SQL template returns null', async () => {
    const response = await client.request('textDocument/hover', {
      textDocument: { uri: tsFileUri() },
      position: { line: 0, character: 5 },
    });
    assert.strictEqual(
      response.result,
      null,
      'Hover outside template should be null',
    );
  });

  test('hover on unknown word returns null', async () => {
    // "users" is a table name, not a known ClickHouse function/keyword
    const hoverLine = TS_TEST_FILE_CONTENT.split('\n').findIndex((l) =>
      l.includes('sql`SELECT count() FROM users'),
    );
    const lineText = TS_TEST_FILE_CONTENT.split('\n')[hoverLine];
    const usersIdx = lineText.indexOf('users');

    const response = await client.request('textDocument/hover', {
      textDocument: { uri: tsFileUri() },
      position: { line: hoverLine, character: usersIdx + 1 },
    });
    assert.strictEqual(
      response.result,
      null,
      'Hover on unknown word should be null',
    );
  });

  // ---- Feature 5: Code Actions — Format SQL ----

  test('Format SQL action is offered for valid lowercase SQL', async () => {
    const fmtLine = TS_TEST_FILE_CONTENT.split('\n').findIndex((l) =>
      l.includes('sql`select * from users'),
    );

    const response = await client.request('textDocument/codeAction', {
      textDocument: { uri: tsFileUri() },
      range: {
        start: { line: fmtLine, character: 15 },
        end: { line: fmtLine, character: 15 },
      },
      context: { diagnostics: [] },
    });

    const actions = response.result as Array<{
      title: string;
      edit?: { changes: Record<string, Array<{ newText: string }>> };
    }>;
    assert.ok(Array.isArray(actions), 'Code actions should be an array');
    const formatAction = actions.find((a) => a.title.includes('Format'));
    assert.ok(formatAction, 'Should offer a Format SQL action');
  });

  test('Format SQL produces uppercase keywords', async () => {
    const fmtLine = TS_TEST_FILE_CONTENT.split('\n').findIndex((l) =>
      l.includes('sql`select * from users'),
    );

    const response = await client.request('textDocument/codeAction', {
      textDocument: { uri: tsFileUri() },
      range: {
        start: { line: fmtLine, character: 15 },
        end: { line: fmtLine, character: 15 },
      },
      context: { diagnostics: [] },
    });

    const actions = response.result as Array<{
      title: string;
      edit?: { changes: Record<string, Array<{ newText: string }>> };
    }>;
    const formatAction = actions.find((a) => a.title.includes('Format'));
    assert.ok(formatAction?.edit, 'Format action should have an edit');
    const edits = Object.values(
      (
        formatAction as {
          edit: { changes: Record<string, Array<{ newText: string }>> };
        }
      ).edit.changes,
    ).flat();
    assert.ok(edits.length > 0, 'Should have at least one text edit');
    const newText = edits[0].newText;
    assert.ok(
      newText.includes('SELECT') && newText.includes('FROM'),
      `Formatted SQL should contain uppercase keywords, got: ${newText}`,
    );
  });

  test('Format SQL not offered for invalid SQL', async () => {
    const invalidLine = TS_TEST_FILE_CONTENT.split('\n').findIndex((l) =>
      l.includes('sql`SELCT * FROM users'),
    );

    const response = await client.request('textDocument/codeAction', {
      textDocument: { uri: tsFileUri() },
      range: {
        start: { line: invalidLine, character: 15 },
        end: { line: invalidLine, character: 15 },
      },
      context: { diagnostics: [] },
    });

    const actions = response.result as Array<{ title: string }>;
    const formatAction = (actions || []).find((a) =>
      a.title.includes('Format'),
    );
    assert.ok(!formatAction, 'Should NOT offer Format SQL for invalid SQL');
  });

  // ---- Feature 8: Aggregate Combinator Functions ----

  test('sumIf appears in completions after "sum" prefix', async () => {
    const pos = cursorAfter(
      TS_TEST_FILE_CONTENT,
      'combPrefix = sql`SELECT sum',
    );
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.some((l) => l === 'sumIf'),
      `Should include sumIf combinator, got: ${labels.slice(0, 20).join(', ')}`,
    );
  });

  test('combinator function has documentation', async () => {
    const pos = cursorAfter(
      TS_TEST_FILE_CONTENT,
      'combPrefix = sql`SELECT sum',
    );
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    const sumIf = items.find((i) => i.label === 'sumIf');
    assert.ok(sumIf, 'Should have sumIf item');
    assert.ok(sumIf.documentation, 'sumIf should have documentation');
    const docValue =
      typeof sumIf.documentation === 'string'
        ? sumIf.documentation
        : (sumIf.documentation as { value: string }).value;
    assert.ok(
      docValue.toLowerCase().includes('combinator') ||
        docValue.toLowerCase().includes('aggregate') ||
        docValue.toLowerCase().includes('if'),
      `sumIf docs should mention combinator/aggregate, got: ${docValue.slice(0, 200)}`,
    );
  });

  test('hover on combinator function shows info', async () => {
    const combLine = TS_TEST_FILE_CONTENT.split('\n').findIndex((l) =>
      l.includes('countIf(status)'),
    );
    const lineText = TS_TEST_FILE_CONTENT.split('\n')[combLine];
    const countIfIdx = lineText.indexOf('countIf');

    const response = await client.request('textDocument/hover', {
      textDocument: { uri: tsFileUri() },
      position: { line: combLine, character: countIfIdx + 1 },
    });
    assert.ok(response.result, 'Hover should return info for countIf');
    const hover = response.result as {
      contents: { kind: string; value: string };
    };
    assert.ok(
      hover.contents.value.length > 0,
      'countIf hover should have content',
    );
  });

  // ---- Feature 9: Multi-word Keywords ----

  test('GROUP BY appears in default context completions', async () => {
    // Use the empty SQL template which triggers Default context (all completions)
    const pos = cursorAfter(TS_TEST_FILE_CONTENT, 'defaultCtx = sql`');
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.some((l) => l === 'GROUP BY'),
      `Should include "GROUP BY" keyword, got sample: ${labels.slice(0, 30).join(', ')}`,
    );
  });

  test('ORDER BY appears in default context completions', async () => {
    const pos = cursorAfter(TS_TEST_FILE_CONTENT, 'defaultCtx = sql`');
    const response = await client.request('textDocument/completion', {
      textDocument: { uri: tsFileUri() },
      position: pos,
    });
    const items = response.result as LspCompletionItem[];
    const labels = items.map((i) => i.label);
    assert.ok(
      labels.some((l) => l === 'ORDER BY'),
      `Should include "ORDER BY" keyword, got sample: ${labels.slice(0, 30).join(', ')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Snippet toggle (separate servers needed)
// ---------------------------------------------------------------------------

describe('Snippet support toggle', () => {
  test('snippets enabled: function completion has snippet format', async () => {
    const tmpDir = await createTsFixture();
    const client = new LspClient(serverPath);

    try {
      await initializeClient(client, `file://${tmpDir}`, true);

      // Use the test.ts file already in the fixture (included in tsconfig)
      const uri = `file://${path.join(tmpDir, 'app', 'test.ts')}`;
      client.openDocument(uri, 'typescript', TS_TEST_FILE_CONTENT);
      await client.waitForDiagnostics(uri);

      const pos = cursorAfter(TS_TEST_FILE_CONTENT, 'prefix = sql`SELECT cou');
      const response = await client.request('textDocument/completion', {
        textDocument: { uri },
        position: pos,
      });
      const items = response.result as LspCompletionItem[];
      const countItem = items.find((i) => i.label === 'count');
      assert.ok(
        countItem,
        `Should have count completion, got: ${items
          .map((i) => i.label)
          .slice(0, 10)
          .join(', ')}`,
      );
      assert.strictEqual(
        countItem.insertText,
        'count($1)$0',
        'Snippet mode should produce snippet insertText',
      );
      assert.strictEqual(
        countItem.insertTextFormat,
        2,
        'insertTextFormat should be Snippet (2)',
      );
    } finally {
      client.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('snippets disabled: function completion has plain format', async () => {
    const tmpDir = await createTsFixture();
    const client = new LspClient(serverPath);

    try {
      await initializeClient(client, `file://${tmpDir}`, false);

      // Use the test.ts file already in the fixture (included in tsconfig)
      const uri = `file://${path.join(tmpDir, 'app', 'test.ts')}`;
      client.openDocument(uri, 'typescript', TS_TEST_FILE_CONTENT);
      await client.waitForDiagnostics(uri);

      const pos = cursorAfter(TS_TEST_FILE_CONTENT, 'prefix = sql`SELECT cou');
      const response = await client.request('textDocument/completion', {
        textDocument: { uri },
        position: pos,
      });
      const items = response.result as LspCompletionItem[];
      const countItem = items.find((i) => i.label === 'count');
      assert.ok(
        countItem,
        `Should have count completion, got: ${items
          .map((i) => i.label)
          .slice(0, 10)
          .join(', ')}`,
      );
      assert.strictEqual(
        countItem.insertText,
        'count()',
        'Non-snippet mode should produce plain insertText',
      );
      assert.strictEqual(
        countItem.insertTextFormat,
        1,
        'insertTextFormat should be PlainText (1)',
      );
    } finally {
      client.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3. ClickHouse version detection
// ---------------------------------------------------------------------------

describe('ClickHouse version detection', () => {
  test('detects version from docker-compose', async () => {
    const tmpDir = await createTsFixtureWithDockerCompose('25.6');
    const client = new LspClient(serverPath);

    try {
      await initializeClient(client, `file://${tmpDir}`);
      const logs = client.getLogMessages();
      assert.ok(
        logs.some((l) => l.includes('Detected ClickHouse version: 25.6')),
        `Should detect version 25.6. Logs: ${logs.join(' | ')}`,
      );
    } finally {
      client.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('falls back to latest when no docker-compose', async () => {
    const tmpDir = await createTsFixture();
    const client = new LspClient(serverPath);

    try {
      await initializeClient(client, `file://${tmpDir}`);
      const logs = client.getLogMessages();
      assert.ok(
        logs.some(
          (l) =>
            l.includes('No ClickHouse version detected, using latest') ||
            l.includes('using latest'),
        ),
        `Should fall back to latest. Logs: ${logs.join(' | ')}`,
      );
    } finally {
      client.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Python project diagnostics
// ---------------------------------------------------------------------------

describe('Python LSP features', () => {
  test('Python invalid SQL produces a diagnostic', async () => {
    const tmpDir = await createPyFixture();
    const client = new LspClient(serverPath);

    try {
      await initializeClient(client, `file://${tmpDir}`);

      const pyUri = `file://${path.join(tmpDir, 'app', 'test.py')}`;
      client.openDocument(pyUri, 'python', PY_TEST_FILE_CONTENT);

      const diagnostics = await client.waitForDiagnostics(pyUri);
      assert.ok(
        diagnostics.length > 0,
        `Expected diagnostics for invalid Python SQL, got none`,
      );
      assert.strictEqual(
        diagnostics[0].severity,
        1,
        'Should be Error severity',
      );
      assert.strictEqual(diagnostics[0].source, 'moose-sql');
    } finally {
      client.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Original basic tests (preserved)
// ---------------------------------------------------------------------------

describe('Server basic protocol', () => {
  test('responds to initialize request', async () => {
    const client = new LspClient(serverPath);

    try {
      const response = await client.request('initialize', {
        processId: null,
        rootUri: 'file:///tmp/test-project',
        capabilities: {},
      });

      assert.ok(response.result, 'Should have result');
      const result = response.result as {
        capabilities: { textDocumentSync: unknown };
      };
      assert.ok(result.capabilities, 'Should have capabilities');
      assert.ok(
        result.capabilities.textDocumentSync,
        'Should have textDocumentSync capability',
      );
    } finally {
      client.close();
    }
  });

  test('handles didSave notification and logs message', async () => {
    const client = new LspClient(serverPath);

    try {
      await client.request('initialize', {
        processId: null,
        rootUri: 'file:///tmp/test-project',
        capabilities: {
          textDocument: {
            synchronization: {
              didSave: true,
            },
          },
        },
      });

      client.notify('initialized', {});
      await new Promise((resolve) => setTimeout(resolve, 100));

      client.openDocument(
        'file:///tmp/test-project/app/test.ts',
        'typescript',
        'const x = 1;',
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      client.saveDocument('file:///tmp/test-project/app/test.ts');

      // Wait for the didSave log
      const deadline = Date.now() + 3000;
      let found = false;
      while (Date.now() < deadline) {
        const logs = client.getLogMessages();
        if (logs.some((l) => l.includes('didSave received'))) {
          found = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.ok(found, 'Should log didSave received message');
    } finally {
      client.close();
    }
  });
});
