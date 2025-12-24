# AGENTS.md

## What This Is

Language Server for Moose TypeScript projects. Currently provides SQL syntax validation for SQL strings embedded in `sql` tagged template literals using a Rust-based ClickHouse SQL parser compiled to WASM.

## Project Structure

```
packages/
├── sql-validator/        # Rust SQL parser core (→ WASM)
├── sql-validator-wasm/   # TypeScript bindings for WASM
└── lsp-server/           # LSP server implementation
```

- `packages/sql-validator/src/lib.rs` - Rust validation logic with WASM bindings
- `packages/lsp-server/src/server.ts` - LSP server entry point
- `packages/lsp-server/src/sqlExtractor.ts` - SQL extraction via TypeScript AST
- `packages/lsp-server/src/projectDetector.ts` - Moose project detection

## Commands

```bash
pnpm build      # Build all (compiles Rust→WASM, then TypeScript)
pnpm test       # Run all tests
pnpm lint       # Biome check + Cargo clippy
pnpm lint:fix   # Auto-fix lint issues
```

## Tech Stack

- **TypeScript**: LSP server, WASM bindings
- **Rust**: SQL validator (compiled to WASM via wasm-pack)
- **pnpm workspaces**: Monorepo management
- **Biome**: Linting and formatting
- **Node native test runner**: `node:test` for all tests

## Architecture: Separation of Concerns

**Rust/WASM layer** - Pure SQL domain logic:
- SQL parsing, validation, context detection
- Returns domain-level data (function names, categories, descriptions, whether something has parameters)
- NO protocol-specific concepts (LSP types, numeric kind constants, snippet syntax)

**TypeScript layer** - Protocol and integration:
- LSP protocol communication (CompletionItem, InsertTextFormat, etc.)
- Maps domain data from Rust to LSP-specific formats
- Handles editor integration, file watching, project detection

**Why this matters**: Keeping Rust focused on "what are valid SQL completions" and TypeScript on "how to present them via LSP" allows the Rust core to be reused for other integrations (CLI tools, other editors) without LSP coupling.

## Verification

Always run before completing work:
```bash
pnpm lint && pnpm build && pnpm test
```

## Additional Context

Read these files when working on specific areas:
- Rust SQL parsing: `packages/sql-validator/src/lib.rs`
- LSP protocol handling: `packages/lsp-server/src/server.ts`
- CI/release process: `.github/workflows/ci.yml`, `scripts/release.sh`
