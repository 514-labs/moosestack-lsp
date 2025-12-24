# MooseStack LSP - VS Code Extension

This is the VS Code/Cursor extension package for the MooseStack Language Server.

## Development

### Building

From the repository root:

```bash
# Build all packages (including LSP server)
pnpm build

# Or build just the extension
cd packages/vscode-extension
pnpm build
```

### Testing Locally

1. Build the extension:
   ```bash
   cd packages/vscode-extension
   pnpm build
   ```

2. Package the extension:
   ```bash
   pnpm package
   ```

3. Install the `.vsix` file in VS Code:
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Extensions: Install from VSIX..."
   - Select the generated `.vsix` file

### Publishing

**Automated Publishing (CI)**

The extension is automatically published to the VS Code Marketplace via GitHub Actions when:
- Code is merged to the `main` branch (continuous deployment)
- A new GitHub release is published (stable release)
- The workflow is manually triggered via `workflow_dispatch`

**Continuous Deployment:**
- On every merge to `main`, both `@514labs/moose-lsp` (to npm with `next` tag) and the VS Code extension are published
- Versions use timestamp-based pre-release format: `{base-version}-{YYYYMMDDHHMMSS}` (e.g., `0.1.0-20241215123456`)
- Users get automatic updates when they update the extension in VS Code/Cursor
- To skip publishing for a specific commit, include `[no-publish]` in the commit message

**Prerequisites for CI Publishing:**
- VS Code Personal Access Token (PAT) stored as `VSCE_PAT` secret in GitHub
- NPM token stored as `NPM_TOKEN` secret in GitHub
- To create a VS Code PAT: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token

**Manual Publishing (Local)**

If you need to publish manually:

1. Build all packages:
   ```bash
   pnpm build
   ```

2. Build the extension:
   ```bash
   cd packages/vscode-extension
   pnpm build
   ```

3. Package:
   ```bash
   pnpm package
   ```

4. Publish:
   ```bash
   VSCE_PAT=your_token_here pnpm publish
   ```

**Note:** The extension bundles `@514labs/moose-lsp` and `@514labs/moose-sql-validator-wasm` as workspace dependencies, so they don't need to be published to npm separately.

## Structure

- `src/extension.ts` - Extension entry point that starts the LSP client
- `package.json` - VS Code extension manifest
- `.vscodeignore` - Files to exclude from the packaged extension

