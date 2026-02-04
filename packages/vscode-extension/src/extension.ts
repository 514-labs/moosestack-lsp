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
  // The server is bundled in the server/ directory (not node_modules to avoid .gitignore issues)
  const serverModule = context.asAbsolutePath(
    path.join('server', '@514labs', 'moose-lsp', 'server.js'),
  );

  // Get debug port from configuration (default 6009)
  const debugPort = vscode.workspace
    .getConfiguration('moosestack-lsp')
    .get<number>('debug.port', 6009);
  const debugOptions = { execArgv: ['--nolazy', `--inspect=${debugPort}`] };

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
  context.subscriptions.push(traceOutputChannel);

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for TypeScript, TypeScript React, and Python documents
    documentSelector: [
      { scheme: 'file', language: 'typescript' },
      { scheme: 'file', language: 'typescriptreact' },
      { scheme: 'file', language: 'python' },
    ],
    synchronize: {
      // Notify the server about file changes to files contained in the workspace
      fileEvents: vscode.workspace.createFileSystemWatcher(
        '**/{package.json,tsconfig.json,moose.config.toml,pyproject.toml,requirements.txt,setup.py}',
      ),
    },
    outputChannel: traceOutputChannel,
    traceOutputChannel: traceOutputChannel,
    initializationOptions: {
      trace: traceSetting,
    },
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
