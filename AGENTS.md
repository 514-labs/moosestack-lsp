# AGENTS.md

## What This Is

SQL Language Server for Moose TypeScript projects. Validates SQL syntax in `sql` tagged template literals using a Rust-based ClickHouse SQL parser compiled to WASM.

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
