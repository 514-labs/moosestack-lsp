<div align="center">
  <a href="https://docs.fiveonefour.com/moose/">
    <picture>
      <img alt="MooseStack logo" src="https://raw.githubusercontent.com/514-labs/moose/main/logo-m-light.png" height="128">
    </picture>
  </a>
  <h1>MooseStack</h1>

<a href="https://www.fiveonefour.com"><img alt="MooseStack logo" src="https://img.shields.io/badge/MADE%20BY-Fiveonefour-black.svg"></a>
<a href="https://github.com/514-labs/moosestack-lsp/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/514-labs/moosestack-lsp/ci.yml?branch=main&logo=github"></a>
<a href="https://www.npmjs.com/package/@514labs/moose-lsp?activeTab=readme"><img alt="NPM version" src="https://img.shields.io/npm/v/%40514labs%2Fmoose-lsp?logo=npm"></a>
<a href="https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg"><img alt="MooseStack Community" src="https://img.shields.io/badge/Slack-MooseStack_community-purple.svg?logo=slack"></a>
<a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>

</div>

# moosestack-lsp

Language Server for Moose TypeScript projects. Provides real-time SQL syntax validation for SQL strings embedded in `sql` tagged templates.

## Editor Features

These features appear directly in your IDE when editing `sql` tagged template literals:

| Feature | What You See in Your Editor |
|---------|---------------------------|
| **Error Diagnostics** | Red squiggly underlines on SQL syntax errors with error messages |
| **Auto-Complete** | Popup suggestions for ClickHouse functions, keywords, data types, table engines, formats, and settings |
| **Context-Aware Completions** | Only relevant completions based on cursor position (e.g., only table engines after `ENGINE =`, only formats after `FORMAT`) |
| **Hover Documentation** | Tooltip with syntax, description, and examples when you hover over any ClickHouse function, keyword, or type |
| **Code Actions** | "Format SQL" action available in your editor's quick-fix menu to auto-format SQL strings |
| **Snippet Support** | Function completions insert with tab stops for parameters (e.g., `toHour($1)`) |

## Additional Features

- **ClickHouse dialect** - Uses the same SQL parser as the Moose CLI
- **ClickHouse version awareness** - Detects your ClickHouse version from `docker-compose.yml` and provides version-appropriate completions
- **Editor agnostic** - Works with any LSP-compatible editor (Neovim, VS Code, Zed, Helix, OpenCode, etc.)
- **Monorepo support** - Automatically detects Moose projects in subdirectories
- **Zero configuration** - Just install and it works

## Prerequisites

- Node.js 18+ (for running the LSP server)
- A Moose TypeScript project with `@514labs/moose-lib` installed (for type resolution)
- An LSP-compatible editor

## Installation

### From Source (Current)

**Build prerequisites:** [Rust](https://rustup.rs/), [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/), [pnpm](https://pnpm.io/)

```bash
# Clone the repository
git clone https://github.com/514-labs/moosestack-lsp.git
cd moosestack-lsp

# Install dependencies and build
pnpm install
pnpm build

# Link globally so the 'moosestack-lsp' command is available
cd packages/lsp-server
pnpm link --global
```

**Verify installation:**

```bash
# Check that the command is available
which moosestack-lsp

# Test that it runs (should not error)
moosestack-lsp --help
# Note: The server may not show help text, but it should start without errors
```

If `which moosestack-lsp` returns nothing, the binary isn't in your PATH. You can either:
- Add the pnpm global bin directory to your PATH (usually `~/.local/share/pnpm` or `~/.pnpm-store`)
- Use the full path to the binary in your editor configuration (see editor-specific setup below)

### From npm (Coming Soon after initial public release)

```bash
npm install -g @514labs/moose-lsp
```

**Verify installation:**

```bash
which moosestack-lsp
moosestack-lsp --help
```

## Editor Setup

### Neovim (with LazyVim)

Add to `~/.config/nvim/lua/plugins/moosestack-lsp.lua`:

```lua
return {
  {
    "neovim/nvim-lspconfig",
    opts = {
      servers = {
        moosestack = {
          cmd = { "moosestack-lsp", "--stdio" },
          filetypes = { "typescript", "typescriptreact" },
          root_markers = { "package.json", "moose.config.toml" },
          mason = false, -- not available in mason yet
        },
      },
    },
  },
}
```

### Neovim (with nvim-lspconfig)

Add to your Neovim config:

```lua
local lspconfig = require('lspconfig')
local configs = require('lspconfig.configs')

-- Define the moosestack LSP configuration
configs.moosestack = {
  default_config = {
    cmd = { 'moosestack-lsp', '--stdio' },
    filetypes = { 'typescript', 'typescriptreact' },
    root_dir = lspconfig.util.root_pattern('package.json', 'moose.config.toml'),
    settings = {},
  },
}

-- Activate the LSP for TypeScript files
lspconfig.moosestack.setup({})
```

### VS Code / Cursor

Since Cursor is a VS Code fork, the same setup works for both editors.

#### Option 1: Install Extension from Marketplace (Recommended)

The extension is published to the VS Code Marketplace when a GitHub release is created. To install:

1. Open VS Code or Cursor
2. Press `Cmd+Shift+X` (Mac) or `Ctrl+Shift+X` (Windows/Linux) to open Extensions
3. Search for "MooseStack LSP" or "moosestack-lsp"
4. Click **Install**

That's it! The extension will automatically start when you open TypeScript files in a Moose project.

**Note:** The extension is published when a GitHub release is created, using the release tag as the version number. You can also trigger a publish manually via the workflow dispatch.

#### Option 2: Install Extension from VSIX (Development/Pre-release)

If you've built the extension locally or have a `.vsix` file:

1. Open VS Code or Cursor
2. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Type "Extensions: Install from VSIX..."
4. Select the `.vsix` file

#### Option 3: Manual Setup with vscode-lspconfig (Advanced)

If you prefer to use the LSP server directly without the extension:

**Step 1: Install the LSP Server**

**Option A: From Source**

1. Build and link the LSP server globally (see [Installation](#installation) section above)
2. Verify the installation by running in your terminal:
   ```bash
   which moosestack-lsp
   # Should output the path to the binary, e.g., /usr/local/bin/moosestack-lsp
   
   moosestack-lsp --help
   # Should show usage information (or at least not error)
   ```

**Option B: From npm**

```bash
npm install -g @514labs/moose-lsp
```

Verify installation:
```bash
which moosestack-lsp
moosestack-lsp --help
```

**Step 2: Install the vscode-lspconfig Extension**

1. Open VS Code or Cursor
2. Press `Cmd+Shift+X` (Mac) or `Ctrl+Shift+X` (Windows/Linux) to open Extensions
3. Search for "vscode-lspconfig" by whtsht
4. Click **Install**

Alternatively, install via command line:
```bash
code --install-extension whtsht.vscode-lspconfig
```

**Step 3: Configure the LSP Server**

1. Open your settings:
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "Preferences: Open User Settings (JSON)"
   - Press Enter

2. Add the following configuration to your `settings.json`:

```json
{
  "vscode-lspconfig.serverConfigurations": [
    {
      "name": "moosestack",
      "document_selector": [
        { "language": "typescript" },
        { "language": "typescriptreact" }
      ],
      "root_patterns": ["package.json", "moose.config.toml"],
      "command": ["moosestack-lsp", "--stdio"]
    }
  ]
}
```

**Note:** If `moosestack-lsp` is not in your PATH, use the full path instead:
```json
"command": ["/full/path/to/moosestack-lsp", "--stdio"]
```

Or use `node` with the full path to the server file:
```json
"command": ["node", "/full/path/to/packages/lsp-server/dist/server.js", "--stdio"]
```

**Step 4: Reload the Window**

1. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. Type "Developer: Reload Window"
3. Press Enter

#### Verify It's Working

1. Open a TypeScript file in a Moose project (must have `@514labs/moose-lib` in `package.json`)
2. Type some SQL in a `sql` tagged template literal
3. You should see:
   - Error diagnostics (red squiggles) for invalid SQL
   - Completions when typing in SQL strings (press `Ctrl+Space` or `Cmd+Space`)
   - Hover documentation when hovering over ClickHouse functions

#### Troubleshooting

**The LSP server isn't starting (Option 3 only):**

1. Check the Output panel:
   - Press `Cmd+Shift+U` (Mac) or `Ctrl+Shift+U` (Windows/Linux)
   - Select "vscode-lspconfig" from the dropdown
   - Look for error messages

2. Verify the command path:
   - Open a terminal and run `which moosestack-lsp`
   - If it's not found, the binary isn't in your PATH
   - Use the full path in your settings.json (see Step 3 above)

3. Test the server manually:
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{}}}' | moosestack-lsp --stdio
   ```
   If this errors, the server binary has an issue.

**No diagnostics appearing:**

1. Ensure you're in a Moose project:
   - Check that `package.json` contains `@514labs/moose-lib`
   - Verify `tsconfig.json` exists in the project root

2. Check file type:
   - The LSP only works on `.ts` and `.tsx` files
   - Make sure your file is recognized as TypeScript

3. Check LSP status:
   - Look at the bottom-right of VS Code/Cursor for LSP status
   - Should show "moosestack" or "MooseStack LSP" as active

4. Check Output panel:
   - Press `Cmd+Shift+U` (Mac) or `Ctrl+Shift+U` (Windows/Linux)
   - Select "MooseStack LSP" or "moosestack" from the dropdown
   - Look for error messages

**Still having issues?**

- Check the [Troubleshooting](#troubleshooting) section below
- Open an issue on [GitHub](https://github.com/514-labs/moosestack-lsp/issues) with:
  - Your OS and editor version
  - Output from the LSP channel
  - Your settings.json configuration (remove any sensitive paths)

### OpenCode

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": {
    "moosestack": {
      "command": ["moosestack-lsp", "--stdio"],
      "extensions": [".ts", ".tsx"]
    }
  }
}
```

## How It Works

1. **Project Detection** - The LSP searches for `package.json` files containing `@514labs/moose-lib` in your workspace
2. **TypeScript Analysis** - Uses the TypeScript compiler API to parse source files and find `sql` tagged template literals
3. **Validation** - Each SQL string is validated using a WASM-compiled Rust SQL parser with ClickHouse dialect
4. **Diagnostics** - Validation errors are published as LSP diagnostics, appearing as error squiggles in your editor

## Example

Given this Moose code:

```typescript
export const MyMV = new MaterializedView<MyData>({
  selectStatement: sql`
    SELECT
      ${cols.name},
      SELCT ${cols.age}  -- Typo: SELCT instead of SELECT
    FROM ${table}
  `,
  // ...
});
```

The LSP will show an error:

```
Invalid SQL in 'MyMV': sql parser error: Expected AS, found: SELCT
```

## Development

### Building from Source

Prerequisites: [Rust](https://rustup.rs/), [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/), [pnpm](https://pnpm.io/)

```bash
# Clone the repository
git clone https://github.com/514-labs/moosestack-lsp.git
cd moosestack-lsp

# Install dependencies
pnpm install

# Build all packages (includes WASM compilation)
pnpm build

# Run tests
pnpm test

# Lint (Biome + Clippy)
pnpm lint
```

### Project Structure

```
moosestack-lsp/
├── packages/
│   ├── sql-validator/         # Rust SQL validator (compiles to WASM)
│   ├── sql-validator-wasm/    # WASM wrapper + TypeScript bindings
│   ├── lsp-server/            # LSP server implementation
│   └── vscode-extension/      # VS Code/Cursor extension
├── scripts/
│   └── release.sh             # Release automation script
└── .github/workflows/         # CI/CD pipelines
```

## Troubleshooting

### No diagnostics appearing

1. Check your editor's LSP logs to ensure the server is starting
2. Verify you're in a Moose project directory (should have `@514labs/moose-lib` in `package.json`)
3. Ensure you're editing TypeScript files (`.ts` or `.tsx`)
4. Check that `tsconfig.json` exists in your project root

## Roadmap

- [x] As-you-type validation
- [x] SQL completions with intelligent sorting (functions, keywords, types, engines, formats)
- [x] Hover documentation for ClickHouse functions and types
- [x] ClickHouse version detection
- [x] Context-aware completions (show only relevant items based on SQL context)
- [x] VS Code extension
- [ ] Python support

## License

MIT

## Made by

The team at [Fiveonefour labs](https://www.fiveonefour.com/), the maintainers of [MooseStack](https://github.com/514-labs/moosestack).

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.
