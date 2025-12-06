# Context-Aware SQL Completions

## Overview

Make SQL completions context-aware by analyzing tokens near the cursor position. Instead of returning all completions everywhere, return only relevant items based on SQL context (e.g., `ENGINE =` shows only table engines).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    TypeScript (LSP)                     │
│  - Loads ClickHouse JSON data                           │
│  - Passes data to Rust once at init                     │
│  - Calls Rust for completions on each request           │
│  - Handles LSP protocol                                 │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                    Rust (WASM)                          │
│  - Stores ClickHouse data in memory                     │
│  - Tokenizes SQL at cursor position                     │
│  - Detects context from tokens (ENGINE=, FORMAT, etc.)  │
│  - Returns filtered CompletionItems                     │
└─────────────────────────────────────────────────────────┘
```

### Design Principles

- **Rust = logic**: All completion intelligence lives in Rust/WASM
- **TypeScript = scaffolding**: LSP protocol handling, data loading
- **Token-based context**: Robust to incomplete/invalid SQL during typing

## Rust API

```rust
/// Initialize completion data. Called once at startup.
/// Takes ClickHouse data as JSON string.
fn init_completion_data(json: &str) -> Result<(), String>

/// Get completions for SQL at cursor position.
/// Returns JSON array of CompletionItem objects.
fn get_completions(sql: &str, cursor_offset: usize, use_snippets: bool) -> String
```

## Context Detection

Token-based pattern matching looking backwards from cursor:

| Context Pattern | Completions |
|-----------------|-------------|
| `ENGINE =` or `ENGINE=` | Table engines only |
| `FORMAT` keyword | Formats only |
| `WHERE` / `HAVING` clause | Functions, logical operators (`AND`, `OR`, `NOT`, `IN`, `BETWEEN`, `LIKE`, `IS NULL`, `IS NOT NULL`) |
| `ORDER BY` / `GROUP BY` | Functions, `ASC`, `DESC`, `NULLS FIRST`, `NULLS LAST` |
| `SELECT` (before `FROM`) | Functions, `DISTINCT`, `AS` |
| `FROM` / `JOIN` | Table functions (`file`, `url`, `s3`, etc.) |
| `CREATE TABLE ... (` column definitions | Data types |
| `SETTINGS` | Settings, MergeTree settings |
| Default / unknown | All completions (fallback) |

### Why No Schema Awareness?

Inside `${...}` template interpolations, the TypeScript LSP provides completions from the `OlapTable` object, which is already mapped to the schema by the Moose runtime. We only need to handle SQL syntax completions.

## Data Structures

### ClickHouse Data (passed to Rust)

```rust
struct CompletionData {
    functions: Vec<FunctionInfo>,
    keywords: Vec<String>,
    data_types: Vec<DataTypeInfo>,
    table_engines: Vec<TableEngineInfo>,
    formats: Vec<FormatInfo>,
    table_functions: Vec<TableFunctionInfo>,
    settings: Vec<SettingInfo>,
    merge_tree_settings: Vec<SettingInfo>,
}
```

### Completion Item (returned from Rust)

```rust
struct CompletionItem {
    label: String,
    kind: CompletionItemKind,
    detail: Option<String>,
    documentation: Option<String>,
    insert_text: Option<String>,
    insert_text_format: Option<InsertTextFormat>,
    sort_text: Option<String>,
}
```

## Migration Path

1. Add new Rust functions (`init_completion_data`, `get_completions`)
2. Update WASM bindings in `sql-validator-wasm`
3. Update TypeScript to call Rust for completions
4. Remove TypeScript completion generation logic (`completions.ts`)

## Out of Scope

- Schema/column awareness (handled by TypeScript LSP in interpolations)
- Full AST parsing (token-based is sufficient and more robust)
- Completion resolve (not currently needed)
