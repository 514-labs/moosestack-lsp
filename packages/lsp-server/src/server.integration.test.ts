import assert from 'node:assert';
import { type ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';
import { test } from 'node:test';

interface LspMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

class LspClient {
  private process: ChildProcess;
  private buffer = '';
  private messages: LspMessage[] = [];
  private nextId = 1;
  private onMessage?: (msg: LspMessage) => void;

  constructor(serverPath: string) {
    this.process = spawn('node', [serverPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.parseMessages();
    });

    this.process.stderr?.on('data', (_data: Buffer) => {
      // Uncomment for debugging:
      // console.error('LSP stderr:', _data.toString());
    });
  }

  private parseMessages() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length: (\d+)/);
      if (!match) break;

      const contentLength = parseInt(match[1], 10);
      const contentStart = headerEnd + 4;
      const contentEnd = contentStart + contentLength;

      if (this.buffer.length < contentEnd) break;

      const content = this.buffer.slice(contentStart, contentEnd);
      this.buffer = this.buffer.slice(contentEnd);

      const message = JSON.parse(content) as LspMessage;
      this.messages.push(message);

      if (this.onMessage) {
        this.onMessage(message);
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
    timeoutMs = 5000,
  ): Promise<LspMessage> {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.onMessage = undefined;
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, timeoutMs);

      this.onMessage = (msg) => {
        if (msg.id === id) {
          clearTimeout(timeout);
          this.onMessage = undefined;
          resolve(msg);
        }
      };

      // Check if response already arrived
      const existing = this.messages.find((m) => m.id === id);
      if (existing) {
        clearTimeout(timeout);
        this.onMessage = undefined;
        resolve(existing);
        return;
      }

      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  async waitForCondition(
    predicate: (messages: LspMessage[]) => boolean,
    timeoutMs = 5000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (predicate(this.messages)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error('Timeout waiting for condition');
  }

  getMessages(): LspMessage[] {
    return [...this.messages];
  }

  close(): void {
    this.process.kill();
  }
}

const serverPath = path.join(__dirname, '..', 'dist', 'server.js');

test('Server Integration Tests', async (t) => {
  await t.test('responds to initialize request', async () => {
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

  await t.test('handles didSave notification and logs message', async () => {
    const client = new LspClient(serverPath);

    try {
      // Initialize
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

      // Send initialized
      client.notify('initialized', {});

      // Wait a bit for server to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Must send didOpen before didSave (TextDocuments requires this)
      client.notify('textDocument/didOpen', {
        textDocument: {
          uri: 'file:///tmp/test-project/app/test.ts',
          languageId: 'typescript',
          version: 1,
          text: 'const x = 1;',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Send didSave
      client.notify('textDocument/didSave', {
        textDocument: {
          uri: 'file:///tmp/test-project/app/test.ts',
        },
      });

      // Wait for the didSave log message
      await client.waitForCondition((messages) => {
        return messages.some((m) => {
          if (m.method !== 'window/logMessage') return false;
          const params = m.params as { message: string };
          return params.message.includes('didSave received');
        });
      }, 3000);

      // Verify
      const messages = client.getMessages();
      const logMessages = messages.filter(
        (m) => m.method === 'window/logMessage',
      );
      const didSaveLog = logMessages.find((m) => {
        const params = m.params as { message: string };
        return params.message.includes('didSave received');
      });

      assert.ok(
        didSaveLog,
        `Should log didSave received message. Got: ${JSON.stringify(logMessages.map((m) => (m.params as { message: string }).message))}`,
      );
    } finally {
      client.close();
    }
  });
});
