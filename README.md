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
- **Editor agnostic** - Works with any LSP-compatible editor
- **Monorepo support** - Automatically detects Moose projects in subdirectories
- **Zero configuration** - Just install and it works

## Prerequisites

- Node.js 18+ (for running the LSP server)
- A Moose TypeScript project with `@514labs/moose-lib` installed (for type resolution)
- An LSP-compatible editor

## Installation

### From npm

```bash
npm install -g @514labs/moose-lsp
```

**Verify installation:**

```bash
which moosestack-lsp
```

### From Source

See [Development](#development) for build prerequisites and instructions. After building, link the package globally:

```bash
cd packages/lsp-server
pnpm link --global
```

**Verify installation:**

```bash
which moosestack-lsp
```

## Editor Setup

### Neovim (with LazyVim)

Add to `~/.config/nvim/lua/plugins/moosestack-lsp.lua`:

```lua
-- Setup moosestack LSP after plugins load
vim.api.nvim_create_autocmd("User", {
  pattern = "LazyDone",
  callback = function()
    local lspconfig = require("lspconfig")
    local configs = require("lspconfig.configs")

    if not configs.moosestack then
      configs.moosestack = {
        default_config = {
          cmd = { "moosestack-lsp", "--stdio" },
          filetypes = { "typescript" },
          root_dir = lspconfig.util.root_pattern("moose.config.toml", "package.json"),
        },
      }
    end

    lspconfig.moosestack.setup({})
  end,
})

return {}
```

### VS Code / Cursor

The extension is published to both the [VS Code Marketplace](https://marketplace.visualstudio.com/) and [Open VSX Registry](https://open-vsx.org/) (used by Cursor). To install:

1. Open VS Code or Cursor
2. Press `Cmd+Shift+X` (Mac) or `Ctrl+Shift+X` (Windows/Linux) to open Extensions
3. Search for "MooseStack LSP" or "moosestack-lsp"
4. Click **Install**

That's it! The extension will automatically start when you open TypeScript files in a Moose project.

### Verify It's Working

1. Open a TypeScript file in a Moose project (must have `@514labs/moose-lib` in `package.json`)
2. Type some SQL in a `sql` tagged template literal
3. You should see:
   - Error diagnostics (red squiggles) for invalid SQL
   - Completions when typing in SQL strings (press `Ctrl+Space` or `Cmd+Space`)
   - Hover documentation when hovering over ClickHouse functions

## How It Works

1. **Project Detection** - The LSP searches for `package.json` files containing `@514labs/moose-lib` in your workspace
2. **TypeScript Analysis** - Uses the TypeScript compiler API to parse source files and find `sql` tagged template literals
3. **Validation** - Each SQL string is validated using a WASM-compiled Rust SQL parser with ClickHouse dialect
4. **Diagnostics** - Validation errors are published as LSP diagnostics, appearing as error squiggles in your editor

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
2. Verify your project has `@514labs/moose-lib` in `package.json` dependencies
3. Ensure you're editing `.ts` files
4. Check that `tsconfig.json` exists in your project root

## Roadmap

- [x] As-you-type validation
- [x] SQL completions with intelligent sorting (functions, keywords, types, engines, formats)
- [x] Hover documentation for ClickHouse functions and types
- [x] ClickHouse version detection
- [x] Context-aware completions (show only relevant items based on SQL context)
- [x] VS Code extension
- [ ] Python support

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.

## License

MIT

## Made by

The team at [Fiveonefour labs](https://www.fiveonefour.com/), the maintainers of [MooseStack](https://github.com/514-labs/moosestack).
