# Context-Aware SQL Completions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make SQL completions context-aware by analyzing tokens near the cursor position in Rust/WASM.

**Architecture:** Token-based context detection in Rust. TypeScript loads ClickHouse JSON data, passes it to Rust once at init. On each completion request, TypeScript calls Rust with SQL + cursor offset, Rust tokenizes, detects context, and returns filtered CompletionItems as JSON.

**Tech Stack:** Rust (sqlparser-rs tokenizer, serde), WASM (wasm-bindgen), TypeScript (LSP server)

---

## Task 1: Define Rust Data Structures

**Files:**
- Modify: `packages/sql-validator/src/lib.rs`

**Step 1: Add completion data structures after existing structs**

```rust
use std::sync::OnceLock;

/// Completion item kind matching LSP spec
#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum CompletionItemKind {
    Function = 3,
    Keyword = 14,
    TypeParameter = 25,
    Class = 7,      // table engines
    Constant = 21,  // formats
    Property = 10,  // settings
    Method = 2,     // aggregate functions
}

/// Insert text format matching LSP spec
#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
pub enum InsertTextFormat {
    PlainText = 1,
    Snippet = 2,
}

/// Completion item returned to LSP
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub label: String,
    pub kind: CompletionItemKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<Documentation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insert_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insert_text_format: Option<InsertTextFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_text: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Documentation {
    pub kind: String, // "markdown"
    pub value: String,
}

/// Function info from ClickHouse data
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FunctionInfo {
    pub name: String,
    pub is_aggregate: bool,
    pub alias_to: Option<String>,
    #[serde(default)]
    pub syntax: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub arguments: String,
    #[serde(default)]
    pub returned_value: String,
    #[serde(default)]
    pub categories: String,
}

/// Data type info from ClickHouse data
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataTypeInfo {
    pub name: String,
    pub alias_to: Option<String>,
}

/// Table engine info from ClickHouse data
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TableEngineInfo {
    pub name: String,
}

/// Format info from ClickHouse data
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub name: String,
    pub is_input: bool,
    pub is_output: bool,
}

/// Table function info from ClickHouse data
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TableFunctionInfo {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

/// Setting info from ClickHouse data
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SettingInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub setting_type: String,
    #[serde(default)]
    pub description: String,
}

/// Full ClickHouse data structure
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClickHouseData {
    pub functions: Vec<FunctionInfo>,
    pub keywords: Vec<String>,
    pub data_types: Vec<DataTypeInfo>,
    pub table_engines: Vec<TableEngineInfo>,
    pub formats: Vec<FormatInfo>,
    pub table_functions: Vec<TableFunctionInfo>,
    pub settings: Vec<SettingInfo>,
    pub merge_tree_settings: Vec<SettingInfo>,
}

/// Pre-built completion items for fast lookup
#[derive(Debug, Default)]
struct CompletionCache {
    all: Vec<CompletionItem>,
    functions: Vec<CompletionItem>,
    keywords: Vec<CompletionItem>,
    data_types: Vec<CompletionItem>,
    table_engines: Vec<CompletionItem>,
    formats: Vec<CompletionItem>,
    table_functions: Vec<CompletionItem>,
    settings: Vec<CompletionItem>,
    // Logical operators for WHERE/HAVING context
    logical_operators: Vec<CompletionItem>,
    // ORDER BY specific keywords
    order_by_keywords: Vec<CompletionItem>,
}

static COMPLETION_CACHE: OnceLock<CompletionCache> = OnceLock::new();
```

**Step 2: Verify it compiles**

Run: `cd packages/sql-validator && cargo check`
Expected: Compiles with no errors

**Step 3: Commit**

```bash
git add packages/sql-validator/src/lib.rs
git commit -m "feat(sql-validator): add completion data structures"
```

---

## Task 2: Implement Completion Cache Building

**Files:**
- Modify: `packages/sql-validator/src/lib.rs`

**Step 1: Add helper functions to build completion items**

Add after the struct definitions:

```rust
const SORT_PRIORITY_KEYWORD: &str = "0_";
const SORT_PRIORITY_FUNCTION: &str = "1_";
const SORT_PRIORITY_DATA_TYPE: &str = "2_";
const SORT_PRIORITY_TABLE_ENGINE: &str = "3_";
const SORT_PRIORITY_FORMAT: &str = "4_";
const SORT_PRIORITY_TABLE_FUNCTION: &str = "5_";
const SORT_PRIORITY_SETTING: &str = "6_";
const SORT_PRIORITY_ALIAS: &str = "9_";

fn build_function_completion(func: &FunctionInfo, use_snippets: bool) -> CompletionItem {
    let kind = if func.is_aggregate {
        CompletionItemKind::Method
    } else {
        CompletionItemKind::Function
    };

    let (insert_text, insert_text_format) = if use_snippets {
        (
            Some(format!("{}($1)$0", func.name)),
            Some(InsertTextFormat::Snippet),
        )
    } else {
        (
            Some(format!("{}()", func.name)),
            Some(InsertTextFormat::PlainText),
        )
    };

    let detail = if let Some(ref alias) = func.alias_to {
        Some(format!("(alias for {alias})"))
    } else if func.is_aggregate {
        Some("(aggregate function)".to_string())
    } else {
        Some("(function)".to_string())
    };

    let sort_text = if func.alias_to.is_some() {
        format!("{SORT_PRIORITY_ALIAS}{}", func.name)
    } else {
        format!("{SORT_PRIORITY_FUNCTION}{}", func.name)
    };

    let documentation = build_function_documentation(func);

    CompletionItem {
        label: func.name.clone(),
        kind,
        detail,
        documentation,
        insert_text,
        insert_text_format,
        sort_text: Some(sort_text),
    }
}

fn build_function_documentation(func: &FunctionInfo) -> Option<Documentation> {
    let mut parts = Vec::new();

    if !func.syntax.is_empty() {
        parts.push(format!("**Syntax:** `{}`", func.syntax));
    }
    if !func.description.is_empty() {
        parts.push(func.description.trim().to_string());
    }
    if !func.arguments.is_empty() {
        parts.push(format!("**Arguments:**\n{}", func.arguments.trim()));
    }
    if !func.returned_value.is_empty() {
        parts.push(format!("**Returns:**\n{}", func.returned_value.trim()));
    }
    if !func.categories.is_empty() {
        parts.push(format!("**Category:** {}", func.categories));
    }

    if parts.is_empty() {
        None
    } else {
        Some(Documentation {
            kind: "markdown".to_string(),
            value: parts.join("\n\n"),
        })
    }
}

fn build_keyword_completion(keyword: &str) -> CompletionItem {
    CompletionItem {
        label: keyword.to_string(),
        kind: CompletionItemKind::Keyword,
        detail: Some("(keyword)".to_string()),
        documentation: None,
        insert_text: Some(keyword.to_string()),
        insert_text_format: None,
        sort_text: Some(format!("{SORT_PRIORITY_KEYWORD}{keyword}")),
    }
}

fn build_data_type_completion(dt: &DataTypeInfo) -> CompletionItem {
    let (detail, sort_text) = if let Some(ref alias) = dt.alias_to {
        (
            Some(format!("(alias for {alias})")),
            format!("{SORT_PRIORITY_ALIAS}{}", dt.name),
        )
    } else {
        (
            Some("(data type)".to_string()),
            format!("{SORT_PRIORITY_DATA_TYPE}{}", dt.name),
        )
    };

    CompletionItem {
        label: dt.name.clone(),
        kind: CompletionItemKind::TypeParameter,
        detail,
        documentation: None,
        insert_text: None,
        insert_text_format: None,
        sort_text: Some(sort_text),
    }
}

fn build_table_engine_completion(engine: &TableEngineInfo) -> CompletionItem {
    CompletionItem {
        label: engine.name.clone(),
        kind: CompletionItemKind::Class,
        detail: Some("(table engine)".to_string()),
        documentation: None,
        insert_text: None,
        insert_text_format: None,
        sort_text: Some(format!("{SORT_PRIORITY_TABLE_ENGINE}{}", engine.name)),
    }
}

fn build_format_completion(format: &FormatInfo) -> CompletionItem {
    let detail = match (format.is_input, format.is_output) {
        (true, true) => "(format: input/output)",
        (true, false) => "(format: input only)",
        (false, true) => "(format: output only)",
        (false, false) => "(format)",
    };

    CompletionItem {
        label: format.name.clone(),
        kind: CompletionItemKind::Constant,
        detail: Some(detail.to_string()),
        documentation: None,
        insert_text: None,
        insert_text_format: None,
        sort_text: Some(format!("{SORT_PRIORITY_FORMAT}{}", format.name)),
    }
}

fn build_table_function_completion(tf: &TableFunctionInfo, use_snippets: bool) -> CompletionItem {
    let (insert_text, insert_text_format) = if use_snippets {
        (
            Some(format!("{}($1)$0", tf.name)),
            Some(InsertTextFormat::Snippet),
        )
    } else {
        (
            Some(format!("{}()", tf.name)),
            Some(InsertTextFormat::PlainText),
        )
    };

    let documentation = if tf.description.is_empty() {
        None
    } else {
        Some(Documentation {
            kind: "markdown".to_string(),
            value: tf.description.trim().to_string(),
        })
    };

    CompletionItem {
        label: tf.name.clone(),
        kind: CompletionItemKind::Function,
        detail: Some("(table function)".to_string()),
        documentation,
        insert_text,
        insert_text_format,
        sort_text: Some(format!("{SORT_PRIORITY_TABLE_FUNCTION}{}", tf.name)),
    }
}

fn build_setting_completion(setting: &SettingInfo, is_merge_tree: bool) -> CompletionItem {
    let detail = if is_merge_tree {
        format!("(MergeTree setting: {})", setting.setting_type)
    } else {
        format!("(setting: {})", setting.setting_type)
    };

    let documentation = if setting.description.is_empty() {
        None
    } else {
        Some(Documentation {
            kind: "markdown".to_string(),
            value: setting.description.trim().to_string(),
        })
    };

    CompletionItem {
        label: setting.name.clone(),
        kind: CompletionItemKind::Property,
        detail: Some(detail),
        documentation,
        insert_text: None,
        insert_text_format: None,
        sort_text: Some(format!("{SORT_PRIORITY_SETTING}{}", setting.name)),
    }
}
```

**Step 2: Add the cache building function**

```rust
fn build_completion_cache(data: &ClickHouseData, use_snippets: bool) -> CompletionCache {
    let mut cache = CompletionCache::default();

    // Build function completions
    for func in &data.functions {
        let item = build_function_completion(func, use_snippets);
        cache.functions.push(item.clone());
        cache.all.push(item);
    }

    // Build keyword completions
    for keyword in &data.keywords {
        let item = build_keyword_completion(keyword);
        cache.keywords.push(item.clone());
        cache.all.push(item);
    }

    // Build data type completions
    for dt in &data.data_types {
        let item = build_data_type_completion(dt);
        cache.data_types.push(item.clone());
        cache.all.push(item);
    }

    // Build table engine completions
    for engine in &data.table_engines {
        let item = build_table_engine_completion(engine);
        cache.table_engines.push(item.clone());
        cache.all.push(item);
    }

    // Build format completions
    for format in &data.formats {
        let item = build_format_completion(format);
        cache.formats.push(item.clone());
        cache.all.push(item);
    }

    // Build table function completions
    for tf in &data.table_functions {
        let item = build_table_function_completion(tf, use_snippets);
        cache.table_functions.push(item.clone());
        cache.all.push(item);
    }

    // Build setting completions
    for setting in &data.settings {
        let item = build_setting_completion(setting, false);
        cache.settings.push(item.clone());
        cache.all.push(item);
    }
    for setting in &data.merge_tree_settings {
        let item = build_setting_completion(setting, true);
        cache.settings.push(item.clone());
        cache.all.push(item);
    }

    // Build logical operator completions for WHERE/HAVING context
    let logical_ops = ["AND", "OR", "NOT", "IN", "BETWEEN", "LIKE", "IS NULL", "IS NOT NULL"];
    for op in logical_ops {
        cache.logical_operators.push(build_keyword_completion(op));
    }

    // Build ORDER BY specific keywords
    let order_keywords = ["ASC", "DESC", "NULLS FIRST", "NULLS LAST"];
    for kw in order_keywords {
        cache.order_by_keywords.push(build_keyword_completion(kw));
    }

    cache
}
```

**Step 3: Verify it compiles**

Run: `cd packages/sql-validator && cargo check`
Expected: Compiles with no errors

**Step 4: Commit**

```bash
git add packages/sql-validator/src/lib.rs
git commit -m "feat(sql-validator): add completion cache building"
```

---

## Task 3: Implement Context Detection

**Files:**
- Modify: `packages/sql-validator/src/lib.rs`

**Step 1: Add context enum and detection logic**

```rust
use sqlparser::tokenizer::{Token, Tokenizer};

/// SQL context detected from tokens before cursor
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SqlContext {
    /// After ENGINE = (show table engines)
    Engine,
    /// After FORMAT keyword (show formats)
    Format,
    /// In WHERE or HAVING clause (show functions + logical operators)
    WhereClause,
    /// After ORDER BY or GROUP BY (show functions + ASC/DESC/NULLS)
    OrderByClause,
    /// In SELECT before FROM (show functions, DISTINCT, AS)
    SelectClause,
    /// After FROM or JOIN (show table functions)
    FromClause,
    /// In column definition after CREATE TABLE ( (show data types)
    ColumnDefinition,
    /// After SETTINGS keyword (show settings)
    Settings,
    /// Unknown/default context (show all)
    Default,
}

/// Detects SQL context from tokens before cursor position
fn detect_context(sql: &str, cursor_offset: usize) -> SqlContext {
    let sql_before_cursor = if cursor_offset <= sql.len() {
        &sql[..cursor_offset]
    } else {
        sql
    };

    let dialect = ClickHouseDialect {};
    let tokens = match Tokenizer::new(&dialect, sql_before_cursor).tokenize() {
        Ok(t) => t,
        Err(_) => return SqlContext::Default,
    };

    // Filter out whitespace for easier pattern matching
    let significant_tokens: Vec<&Token> = tokens
        .iter()
        .filter(|t| !matches!(t, Token::Whitespace(_)))
        .collect();

    if significant_tokens.is_empty() {
        return SqlContext::Default;
    }

    // Look at last few tokens to determine context
    let len = significant_tokens.len();

    // Check for ENGINE = pattern (last token is = or Eq, before that is ENGINE)
    if len >= 2 {
        if matches!(significant_tokens[len - 1], Token::Eq) {
            if is_keyword_token(significant_tokens[len - 2], "ENGINE") {
                return SqlContext::Engine;
            }
        }
    }

    // Check for ENGINE = X pattern (we're right after ENGINE =, starting to type)
    if len >= 1 && is_keyword_token(significant_tokens[len - 1], "ENGINE") {
        // Check if next non-whitespace in original is =
        let remaining = &sql[cursor_offset..];
        if remaining.trim_start().starts_with('=') {
            return SqlContext::Engine;
        }
    }

    // Check for FORMAT keyword (last significant token)
    if is_keyword_token(significant_tokens[len - 1], "FORMAT") {
        return SqlContext::Format;
    }

    // Check for SETTINGS keyword
    if is_keyword_token(significant_tokens[len - 1], "SETTINGS") {
        return SqlContext::Settings;
    }

    // Scan backwards to find clause context
    for i in (0..len).rev() {
        let token = significant_tokens[i];

        // Check for WHERE or HAVING
        if is_keyword_token(token, "WHERE") || is_keyword_token(token, "HAVING") {
            // Make sure we haven't passed another major clause
            if !has_clause_after(&significant_tokens[i + 1..], &["ORDER", "GROUP", "LIMIT", "FORMAT", "SETTINGS"]) {
                return SqlContext::WhereClause;
            }
        }

        // Check for ORDER BY or GROUP BY
        if is_keyword_token(token, "BY") && i > 0 {
            let prev = significant_tokens[i - 1];
            if is_keyword_token(prev, "ORDER") || is_keyword_token(prev, "GROUP") {
                if !has_clause_after(&significant_tokens[i + 1..], &["LIMIT", "FORMAT", "SETTINGS", "HAVING", "WHERE"]) {
                    return SqlContext::OrderByClause;
                }
            }
        }

        // Check for FROM or JOIN
        if is_keyword_token(token, "FROM") || is_keyword_token(token, "JOIN") {
            if !has_clause_after(&significant_tokens[i + 1..], &["WHERE", "GROUP", "ORDER", "LIMIT", "FORMAT", "SETTINGS"]) {
                return SqlContext::FromClause;
            }
        }

        // Check for SELECT (and no FROM yet)
        if is_keyword_token(token, "SELECT") {
            if !has_clause_after(&significant_tokens[i + 1..], &["FROM"]) {
                return SqlContext::SelectClause;
            }
        }

        // Check for CREATE TABLE ... ( pattern for column definitions
        if matches!(token, Token::LParen) && i >= 2 {
            if is_keyword_token(significant_tokens[i - 1], "TABLE")
                || (i >= 3
                    && is_keyword_token(significant_tokens[i - 2], "TABLE")
                    && is_keyword_token(significant_tokens[i - 3], "CREATE"))
            {
                // We're inside CREATE TABLE (...) - show data types
                return SqlContext::ColumnDefinition;
            }
        }
    }

    SqlContext::Default
}

fn is_keyword_token(token: &Token, keyword: &str) -> bool {
    matches!(token, Token::Word(w) if w.value.eq_ignore_ascii_case(keyword))
}

fn has_clause_after(tokens: &[&Token], keywords: &[&str]) -> bool {
    tokens.iter().any(|t| {
        keywords.iter().any(|kw| is_keyword_token(t, kw))
    })
}
```

**Step 2: Verify it compiles**

Run: `cd packages/sql-validator && cargo check`
Expected: Compiles with no errors

**Step 3: Commit**

```bash
git add packages/sql-validator/src/lib.rs
git commit -m "feat(sql-validator): add SQL context detection"
```

---

## Task 4: Implement WASM API Functions

**Files:**
- Modify: `packages/sql-validator/src/lib.rs`

**Step 1: Add the init_completion_data function**

```rust
#[derive(Serialize, Deserialize, Debug)]
pub struct InitResult {
    pub success: bool,
    pub error: Option<String>,
}

// Store the use_snippets setting
static USE_SNIPPETS: OnceLock<bool> = OnceLock::new();

#[wasm_bindgen]
pub fn init_completion_data(json: &str, use_snippets: bool) -> String {
    let result = match serde_json::from_str::<ClickHouseData>(json) {
        Ok(data) => {
            let cache = build_completion_cache(&data, use_snippets);
            match COMPLETION_CACHE.set(cache) {
                Ok(()) => {
                    let _ = USE_SNIPPETS.set(use_snippets);
                    InitResult {
                        success: true,
                        error: None,
                    }
                }
                Err(_) => InitResult {
                    success: false,
                    error: Some("Completion data already initialized".to_string()),
                },
            }
        }
        Err(e) => InitResult {
            success: false,
            error: Some(format!("Failed to parse ClickHouse data: {e}")),
        },
    };

    serde_json::to_string(&result).unwrap_or_else(|_| {
        r#"{"success":false,"error":"Internal serialization error"}"#.to_string()
    })
}
```

**Step 2: Add the get_completions function**

```rust
#[wasm_bindgen]
pub fn get_completions(sql: &str, cursor_offset: usize) -> String {
    let Some(cache) = COMPLETION_CACHE.get() else {
        return "[]".to_string();
    };

    let context = detect_context(sql, cursor_offset);

    let items: &[CompletionItem] = match context {
        SqlContext::Engine => &cache.table_engines,
        SqlContext::Format => &cache.formats,
        SqlContext::WhereClause => {
            // Return functions + logical operators
            // We need to combine them - create a temp vec
            return serde_json::to_string(
                &cache
                    .functions
                    .iter()
                    .chain(cache.logical_operators.iter())
                    .collect::<Vec<_>>(),
            )
            .unwrap_or_else(|_| "[]".to_string());
        }
        SqlContext::OrderByClause => {
            // Return functions + ORDER BY keywords
            return serde_json::to_string(
                &cache
                    .functions
                    .iter()
                    .chain(cache.order_by_keywords.iter())
                    .collect::<Vec<_>>(),
            )
            .unwrap_or_else(|_| "[]".to_string());
        }
        SqlContext::SelectClause => &cache.functions,
        SqlContext::FromClause => &cache.table_functions,
        SqlContext::ColumnDefinition => &cache.data_types,
        SqlContext::Settings => &cache.settings,
        SqlContext::Default => &cache.all,
    };

    serde_json::to_string(items).unwrap_or_else(|_| "[]".to_string())
}
```

**Step 3: Verify it compiles**

Run: `cd packages/sql-validator && cargo check`
Expected: Compiles with no errors (may have warnings about unused, that's ok)

**Step 4: Commit**

```bash
git add packages/sql-validator/src/lib.rs
git commit -m "feat(sql-validator): add WASM completion API functions"
```

---

## Task 5: Add Rust Unit Tests

**Files:**
- Modify: `packages/sql-validator/src/lib.rs`

**Step 1: Add tests for context detection**

Add to the existing `#[cfg(test)]` module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    // ... existing tests ...

    #[test]
    fn test_detect_context_engine() {
        assert_eq!(detect_context("CREATE TABLE t ENGINE = ", 24), SqlContext::Engine);
        assert_eq!(detect_context("CREATE TABLE t ENGINE =", 23), SqlContext::Engine);
        assert_eq!(detect_context("ENGINE = M", 10), SqlContext::Engine);
    }

    #[test]
    fn test_detect_context_format() {
        assert_eq!(detect_context("SELECT * FROM t FORMAT ", 23), SqlContext::Format);
        assert_eq!(detect_context("SELECT * FORMAT ", 16), SqlContext::Format);
    }

    #[test]
    fn test_detect_context_where() {
        assert_eq!(detect_context("SELECT * FROM t WHERE ", 22), SqlContext::WhereClause);
        assert_eq!(detect_context("SELECT * FROM t WHERE x = 1 AND ", 32), SqlContext::WhereClause);
    }

    #[test]
    fn test_detect_context_having() {
        assert_eq!(detect_context("SELECT * FROM t GROUP BY x HAVING ", 34), SqlContext::WhereClause);
    }

    #[test]
    fn test_detect_context_order_by() {
        assert_eq!(detect_context("SELECT * FROM t ORDER BY ", 25), SqlContext::OrderByClause);
        assert_eq!(detect_context("SELECT * FROM t ORDER BY x ", 27), SqlContext::OrderByClause);
    }

    #[test]
    fn test_detect_context_group_by() {
        assert_eq!(detect_context("SELECT * FROM t GROUP BY ", 25), SqlContext::OrderByClause);
    }

    #[test]
    fn test_detect_context_select() {
        assert_eq!(detect_context("SELECT ", 7), SqlContext::SelectClause);
        assert_eq!(detect_context("SELECT x, ", 10), SqlContext::SelectClause);
    }

    #[test]
    fn test_detect_context_from() {
        assert_eq!(detect_context("SELECT * FROM ", 14), SqlContext::FromClause);
    }

    #[test]
    fn test_detect_context_settings() {
        assert_eq!(detect_context("SELECT * FROM t SETTINGS ", 25), SqlContext::Settings);
    }

    #[test]
    fn test_detect_context_default() {
        assert_eq!(detect_context("", 0), SqlContext::Default);
        assert_eq!(detect_context("SEL", 3), SqlContext::Default);
    }

    #[test]
    fn test_detect_context_column_definition() {
        assert_eq!(detect_context("CREATE TABLE t (id ", 19), SqlContext::ColumnDefinition);
        assert_eq!(detect_context("CREATE TABLE t (id UInt64, name ", 32), SqlContext::ColumnDefinition);
    }
}
```

**Step 2: Run tests**

Run: `cd packages/sql-validator && cargo test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/sql-validator/src/lib.rs
git commit -m "test(sql-validator): add context detection tests"
```

---

## Task 6: Update WASM TypeScript Bindings

**Files:**
- Modify: `packages/sql-validator-wasm/src/index.ts`

**Step 1: Add new types and exports**

```typescript
export interface ValidationResult {
  valid: boolean;
  error?: {
    message: string;
    line?: number;
    column?: number;
  };
}

export interface FormatResult {
  success: boolean;
  formatted?: string;
  error?: string;
}

export interface InitCompletionResult {
  success: boolean;
  error?: string;
}

export interface CompletionItem {
  label: string;
  kind: number;
  detail?: string;
  documentation?: {
    kind: string;
    value: string;
  };
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
}

// The nodejs target auto-initializes WASM synchronously
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wasmModule = require('../pkg/sql_validator.js');

export async function initValidator(): Promise<void> {
  // No-op - WASM is auto-initialized by the nodejs target
  return Promise.resolve();
}

export function validateSql(sql: string): ValidationResult {
  const resultJson = wasmModule.validate_sql(sql);
  return JSON.parse(resultJson);
}

export function formatSql(sql: string): FormatResult {
  const resultJson = wasmModule.format_sql(sql);
  return JSON.parse(resultJson);
}

export function initCompletionData(
  json: string,
  useSnippets: boolean,
): InitCompletionResult {
  const resultJson = wasmModule.init_completion_data(json, useSnippets);
  return JSON.parse(resultJson);
}

export function getCompletions(sql: string, cursorOffset: number): CompletionItem[] {
  const resultJson = wasmModule.get_completions(sql, cursorOffset);
  return JSON.parse(resultJson);
}
```

**Step 2: Build WASM and TypeScript**

Run: `pnpm build`
Expected: Builds successfully

**Step 3: Commit**

```bash
git add packages/sql-validator-wasm/src/index.ts
git commit -m "feat(sql-validator-wasm): add completion API bindings"
```

---

## Task 7: Add WASM Integration Tests

**Files:**
- Modify: `packages/sql-validator-wasm/src/index.test.ts`

**Step 1: Read the existing test file and add new tests**

Add to existing test file:

```typescript
import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  validateSql,
  formatSql,
  initCompletionData,
  getCompletions,
} from './index';

// ... existing tests ...

describe('completions', () => {
  // Minimal test data matching ClickHouseData structure
  const testData = JSON.stringify({
    version: '25.8',
    extractedAt: '2025-01-01T00:00:00Z',
    functions: [
      {
        name: 'count',
        isAggregate: true,
        caseInsensitive: true,
        aliasTo: null,
        syntax: 'count()',
        description: 'Counts rows',
        arguments: '',
        returnedValue: 'UInt64',
        examples: '',
        categories: 'Aggregate',
      },
    ],
    keywords: ['SELECT', 'FROM', 'WHERE'],
    dataTypes: [{ name: 'UInt64', caseInsensitive: false, aliasTo: null }],
    tableEngines: [{ name: 'MergeTree' }],
    formats: [{ name: 'JSON', isInput: true, isOutput: true }],
    tableFunctions: [{ name: 'file', description: 'Reads from file' }],
    aggregateCombinators: [],
    settings: [{ name: 'max_threads', type: 'UInt64', description: 'Max threads' }],
    mergeTreeSettings: [],
  });

  it('initializes completion data', () => {
    const result = initCompletionData(testData, true);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.error, undefined);
  });

  it('returns all completions for default context', () => {
    const completions = getCompletions('', 0);
    assert.ok(completions.length > 0);
    // Should have functions, keywords, etc.
    assert.ok(completions.some((c) => c.label === 'count'));
    assert.ok(completions.some((c) => c.label === 'SELECT'));
  });

  it('returns only engines after ENGINE =', () => {
    const completions = getCompletions('CREATE TABLE t ENGINE = ', 24);
    assert.ok(completions.length > 0);
    assert.ok(completions.every((c) => c.detail === '(table engine)'));
    assert.ok(completions.some((c) => c.label === 'MergeTree'));
  });

  it('returns only formats after FORMAT', () => {
    const completions = getCompletions('SELECT * FORMAT ', 16);
    assert.ok(completions.length > 0);
    assert.ok(completions.every((c) => c.detail?.includes('format')));
    assert.ok(completions.some((c) => c.label === 'JSON'));
  });

  it('returns functions in WHERE clause', () => {
    const completions = getCompletions('SELECT * FROM t WHERE ', 22);
    assert.ok(completions.some((c) => c.label === 'count'));
    assert.ok(completions.some((c) => c.label === 'AND'));
  });

  it('returns table functions after FROM', () => {
    const completions = getCompletions('SELECT * FROM ', 14);
    assert.ok(completions.some((c) => c.label === 'file'));
  });

  it('returns data types in column definition', () => {
    const completions = getCompletions('CREATE TABLE t (id ', 19);
    assert.ok(completions.some((c) => c.label === 'UInt64'));
  });

  it('returns settings after SETTINGS', () => {
    const completions = getCompletions('SELECT * SETTINGS ', 18);
    assert.ok(completions.some((c) => c.label === 'max_threads'));
  });
});
```

**Step 2: Run tests**

Run: `pnpm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/sql-validator-wasm/src/index.test.ts
git commit -m "test(sql-validator-wasm): add completion integration tests"
```

---

## Task 8: Update LSP Server to Use Rust Completions

**Files:**
- Modify: `packages/lsp-server/src/server.ts`

**Step 1: Update imports and init**

Replace the completions import and add initCompletionData:

```typescript
import {
  initValidator,
  validateSql,
  initCompletionData,
  getCompletions,
} from '@514labs/moose-sql-validator-wasm';
```

**Step 2: Update loadClickHouseCompletionData function**

Replace the existing function:

```typescript
/**
 * Loads ClickHouse completion data and initializes Rust completion engine.
 * Falls back to latest available version if detection fails.
 */
async function loadClickHouseCompletionData(
  projectRoot: string,
): Promise<void> {
  try {
    // Try to detect version from docker-compose
    let version = await detectClickHouseVersion(projectRoot);

    if (version) {
      connection.console.log(`Detected ClickHouse version: ${version}`);
    } else {
      // Fall back to latest available version
      const available = getAvailableVersions();
      if (available.length > 0) {
        version = available[0]; // Already sorted descending
        connection.console.log(
          `No ClickHouse version detected, using latest: ${version}`,
        );
      } else {
        connection.console.warn('No ClickHouse data files available');
        return;
      }
    }

    clickhouseData = await loadClickHouseData(version);

    if (clickhouseData.warning) {
      connection.console.warn(clickhouseData.warning);
    }

    // Initialize Rust completion engine with the data
    const jsonData = JSON.stringify(clickhouseData);
    const initResult = initCompletionData(jsonData, clientSupportsSnippets);

    if (!initResult.success) {
      connection.console.error(
        `Failed to init completion data: ${initResult.error}`,
      );
      return;
    }

    connection.console.log(
      `Loaded ClickHouse data: ${clickhouseData.functions.length} functions, ${clickhouseData.keywords.length} keywords`,
    );
  } catch (error) {
    if (error instanceof Error) {
      connection.console.error(
        `Failed to load ClickHouse data: ${error.message}`,
      );
    } else {
      connection.console.error(`Failed to load ClickHouse data: ${error}`);
    }
  }
}
```

**Step 3: Update completion handler**

Replace the existing `connection.onCompletion` handler:

```typescript
// Completion handler - provides context-aware SQL completions inside sql template literals
connection.onCompletion((params: CompletionParams): CompletionItem[] => {
  if (!tsService?.isHealthy() || !mooseProjectRoot || !clickhouseData) {
    return [];
  }

  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const filePath = new URL(params.textDocument.uri).pathname;
  if (!shouldValidateFile(filePath, mooseProjectRoot)) return [];

  try {
    const sourceFile = tsService.getSourceFile(filePath);
    if (!sourceFile) return [];

    const sqlLocations = extractSqlLocations(
      sourceFile,
      tsService.getTypeChecker(),
    );

    // Check if cursor is inside any SQL template
    const location = findSqlTemplateAtPosition(
      sqlLocations,
      params.position.line,
      params.position.character,
    );

    if (!location) return [];

    // Calculate cursor offset within the SQL template
    const cursorLine = params.position.line;
    const cursorChar = params.position.character;
    const templateStartLine = location.startLine;
    const templateStartChar = location.startColumn;

    // Get the SQL text and calculate offset
    const sqlText = location.templateText;
    let cursorOffset = 0;

    // Count characters from start of template to cursor position
    const lines = sqlText.split('\n');
    const relativeLine = cursorLine - templateStartLine;

    for (let i = 0; i < relativeLine && i < lines.length; i++) {
      cursorOffset += lines[i].length + 1; // +1 for newline
    }

    if (relativeLine === 0) {
      cursorOffset += cursorChar - templateStartChar;
    } else if (relativeLine < lines.length) {
      cursorOffset += cursorChar;
    }

    // Clamp to valid range
    cursorOffset = Math.max(0, Math.min(cursorOffset, sqlText.length));

    // Get context-aware completions from Rust
    const completions = getCompletions(sqlText, cursorOffset);

    // Get prefix for filtering
    const lineText = document.getText({
      start: { line: params.position.line, character: 0 },
      end: params.position,
    });
    const wordMatch = lineText.match(/[\w]+$/);
    const prefix = wordMatch ? wordMatch[0].toLowerCase() : '';

    // Filter by prefix if present
    if (prefix) {
      return completions.filter((c) =>
        c.label.toLowerCase().startsWith(prefix),
      );
    }

    return completions;
  } catch {
    return [];
  }
});
```

**Step 4: Remove old imports**

Remove the import for `filterCompletions` and `generateCompletionItems` from completions.ts (they're no longer used).

**Step 5: Verify it compiles**

Run: `pnpm build`
Expected: Builds successfully

**Step 6: Commit**

```bash
git add packages/lsp-server/src/server.ts
git commit -m "feat(lsp-server): use Rust completion engine"
```

---

## Task 9: Update LSP Server Tests

**Files:**
- Modify: `packages/lsp-server/src/server.integration.test.ts` (if exists, or create)

**Step 1: Check if integration tests exist**

Look at existing test file and add completion integration tests that verify context-aware behavior.

**Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add -A
git commit -m "test(lsp-server): update completion tests for context awareness"
```

---

## Task 10: Clean Up Old TypeScript Completion Code

**Files:**
- Modify: `packages/lsp-server/src/completions.ts`
- Modify: `packages/lsp-server/src/completions.test.ts`

**Step 1: Evaluate what to keep**

The `completions.ts` file may still be useful for:
- Type definitions (if needed)
- Tests could be repurposed for Rust integration testing

Consider keeping the file but marking exports as deprecated, or removing entirely if no longer needed.

**Step 2: Run lint and tests**

Run: `pnpm lint && pnpm test`
Expected: All pass

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: clean up deprecated TypeScript completion code"
```

---

## Task 11: Final Verification

**Step 1: Full build and test**

Run: `pnpm lint && pnpm build && pnpm test`
Expected: All pass

**Step 2: Manual testing**

Test the LSP in an actual editor with various SQL contexts to verify context-aware completions work.

---

## Summary

After completing all tasks:

1. Rust handles all completion logic with token-based context detection
2. TypeScript passes ClickHouse data once at init, then calls Rust per request
3. Context-aware completions for: ENGINE, FORMAT, WHERE, ORDER BY, GROUP BY, SELECT, FROM, SETTINGS, column definitions
4. Falls back to all completions for unknown contexts
