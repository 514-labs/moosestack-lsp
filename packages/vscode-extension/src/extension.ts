import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

// Module-scoped LanguageClient shared between activate() and deactivate()
// to allow VS Code to stop the client during extension deactivation.
let client: LanguageClient | null = null;

export function activate(context: vscode.ExtensionContext): void {
  // The server is implemented in Node.js
  // Resolve the server module path - works in both development and packaged extension
  let serverModule: string;
  try {
    // Try to resolve from node_modules (packaged extension or workspace)
    serverModule = require.resolve('@514labs/moose-lsp/dist/server.js', {
      paths: [context.extensionPath],
    });
  } catch {
    // Fallback: try relative to extension path
    serverModule = context.asAbsolutePath(
      path.join('node_modules', '@514labs', 'moose-lsp', 'dist', 'server.js'),
    );
  }

  // The debug options for the server
  const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.stdio,
      options: {
        execArgv: ['--max-old-space-size=4096'],
      },
    },
    debug: {
      module: serverModule,
      transport: TransportKind.stdio,
      options: debugOptions,
    },
  };

  // Get trace setting from configuration
  const traceSetting = vscode.workspace
    .getConfiguration('moosestack-lsp')
    .get<string>('trace.server', 'off');
  const traceOutputChannel =
    vscode.window.createOutputChannel('MooseStack LSP');

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for TypeScript and TypeScript React documents
    documentSelector: [
      { scheme: 'file', language: 'typescript' },
      { scheme: 'file', language: 'typescriptreact' },
    ],
    synchronize: {
      // Notify the server about file changes to files contained in the workspace
      fileEvents: vscode.workspace.createFileSystemWatcher(
        '**/{package.json,tsconfig.json,moose.config.toml}',
      ),
    },
    outputChannel: traceOutputChannel,
    traceOutputChannel: traceOutputChannel,
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    'moosestack-lsp',
    'MooseStack LSP',
    serverOptions,
    clientOptions,
  );

  // Start the client. This will also launch the server
  client.start();

  // Push the disposable to the context's subscriptions so that the
  // client can be deactivated on extension deactivation
  context.subscriptions.push(client);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
