use serde::{Deserialize, Serialize};
use sqlparser::dialect::ClickHouseDialect;
use sqlparser::parser::Parser;
use sqlparser::tokenizer::{Token, Tokenizer};
use std::sync::OnceLock;
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize, Debug)]
pub struct ValidationResult {
    pub valid: bool,
    pub error: Option<ValidationError>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ValidationError {
    pub message: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FormatResult {
    pub success: bool,
    pub formatted: Option<String>,
    pub error: Option<String>,
}

/// Completion item kind - domain categories for SQL completions
#[derive(Serialize, Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum CompletionItemKind {
    Function,
    Keyword,
    DataType,
    TableEngine,
    Format,
    Setting,
    AggregateFunction,
    TableFunction,
}

/// Completion item returned from Rust - domain data only
/// TypeScript is responsible for mapping to LSP protocol (`CompletionItem`, `InsertTextFormat`, etc.)
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub label: String,
    pub kind: CompletionItemKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<Documentation>,
    /// Whether this completion accepts parameters (for functions)
    /// TypeScript uses this to construct snippet syntax
    #[serde(default)]
    pub has_params: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_text: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Documentation {
    pub kind: String, // "markdown"
    pub value: String,
}

/// Function info from `ClickHouse` data
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

/// Data type info from `ClickHouse` data
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataTypeInfo {
    pub name: String,
    pub alias_to: Option<String>,
}

/// Table engine info from `ClickHouse` data
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TableEngineInfo {
    pub name: String,
}

/// Format info from `ClickHouse` data
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub name: String,
    pub is_input: bool,
    pub is_output: bool,
}

/// Table function info from `ClickHouse` data
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TableFunctionInfo {
    pub name: String,
    #[serde(default)]
    pub description: String,
}

/// Setting info from `ClickHouse` data
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SettingInfo {
    pub name: String,
    #[serde(rename = "type")]
    pub setting_type: String,
    #[serde(default)]
    pub description: String,
}

/// Full `ClickHouse` data structure
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClickHouseData {
    pub functions: Vec<FunctionInfo>,
    pub keywords: Vec<String>,
    pub data_types: Vec<DataTypeInfo>,
    pub table_engines: Vec<TableEngineInfo>,
    pub formats: Vec<FormatInfo>,
    pub table_functions: Vec<TableFunctionInfo>,
    #[serde(default)]
    pub aggregate_combinators: Vec<String>,
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

// Sort priority constants - lower numbers appear first
const SORT_PRIORITY_KEYWORD: &str = "0_";
const SORT_PRIORITY_FUNCTION: &str = "1_";
const SORT_PRIORITY_DATA_TYPE: &str = "2_";
const SORT_PRIORITY_TABLE_ENGINE: &str = "3_";
const SORT_PRIORITY_FORMAT: &str = "4_";
const SORT_PRIORITY_TABLE_FUNCTION: &str = "5_";
const SORT_PRIORITY_SETTING: &str = "6_";
const SORT_PRIORITY_ALIAS: &str = "9_";

fn build_function_completion(
    func: &FunctionInfo,
    all_functions: &[FunctionInfo],
) -> CompletionItem {
    let kind = if func.is_aggregate {
        CompletionItemKind::AggregateFunction
    } else {
        CompletionItemKind::Function
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

    // For aliases, show "alias for X" header + target function's documentation
    let documentation = if let Some(ref alias_to) = func.alias_to {
        // Find the target function (case-insensitive)
        let target = all_functions
            .iter()
            .find(|f| f.name.eq_ignore_ascii_case(alias_to));

        let mut parts = vec![format!("**{}** _(alias for `{}`)_", func.name, alias_to)];

        // Add target function's documentation if found
        if let Some(target_func) = target {
            if let Some(target_doc) = build_function_documentation(target_func) {
                parts.push(target_doc.value);
            }
        }

        Some(Documentation {
            kind: "markdown".to_string(),
            value: parts.join("\n\n"),
        })
    } else {
        build_function_documentation(func)
    };

    CompletionItem {
        label: func.name.clone(),
        kind,
        detail,
        documentation,
        has_params: true, // All functions have parentheses
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
        has_params: false,
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
        kind: CompletionItemKind::DataType,
        detail,
        documentation: None,
        has_params: false,
        sort_text: Some(sort_text),
    }
}

fn build_table_engine_completion(engine: &TableEngineInfo) -> CompletionItem {
    CompletionItem {
        label: engine.name.clone(),
        kind: CompletionItemKind::TableEngine,
        detail: Some("(table engine)".to_string()),
        documentation: None,
        has_params: false,
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
        kind: CompletionItemKind::Format,
        detail: Some(detail.to_string()),
        documentation: None,
        has_params: false,
        sort_text: Some(format!("{SORT_PRIORITY_FORMAT}{}", format.name)),
    }
}

fn build_table_function_completion(tf: &TableFunctionInfo) -> CompletionItem {
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
        kind: CompletionItemKind::TableFunction,
        detail: Some("(table function)".to_string()),
        documentation,
        has_params: true, // Table functions always have parentheses
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
        kind: CompletionItemKind::Setting,
        detail: Some(detail),
        documentation,
        has_params: false,
        sort_text: Some(format!("{SORT_PRIORITY_SETTING}{}", setting.name)),
    }
}

fn build_completion_cache(data: &ClickHouseData) -> CompletionCache {
    let mut cache = CompletionCache::default();

    // Build function completions
    for func in &data.functions {
        let item = build_function_completion(func, &data.functions);
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
        let item = build_table_function_completion(tf);
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
    let logical_ops = [
        "AND",
        "OR",
        "NOT",
        "IN",
        "BETWEEN",
        "LIKE",
        "IS NULL",
        "IS NOT NULL",
    ];
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
    let Ok(tokens) = Tokenizer::new(&dialect, sql_before_cursor).tokenize() else {
        return SqlContext::Default;
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
    if len >= 2
        && matches!(significant_tokens[len - 1], Token::Eq)
        && is_keyword_token(significant_tokens[len - 2], "ENGINE")
    {
        return SqlContext::Engine;
    }

    // Check for ENGINE = X pattern (we're typing the engine name after =)
    if len >= 3
        && matches!(significant_tokens[len - 2], Token::Eq)
        && is_keyword_token(significant_tokens[len - 3], "ENGINE")
    {
        return SqlContext::Engine;
    }

    // Check if we're right after ENGINE keyword and = follows in remaining text
    if len >= 1 && is_keyword_token(significant_tokens[len - 1], "ENGINE") {
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
            if !has_clause_after(
                &significant_tokens[i + 1..],
                &["ORDER", "GROUP", "LIMIT", "FORMAT", "SETTINGS"],
            ) {
                return SqlContext::WhereClause;
            }
        }

        // Check for ORDER BY or GROUP BY
        if is_keyword_token(token, "BY") && i > 0 {
            let prev = significant_tokens[i - 1];
            if (is_keyword_token(prev, "ORDER") || is_keyword_token(prev, "GROUP"))
                && !has_clause_after(
                    &significant_tokens[i + 1..],
                    &["LIMIT", "FORMAT", "SETTINGS", "HAVING", "WHERE"],
                )
            {
                return SqlContext::OrderByClause;
            }
        }

        // Check for FROM or JOIN
        if (is_keyword_token(token, "FROM") || is_keyword_token(token, "JOIN"))
            && !has_clause_after(
                &significant_tokens[i + 1..],
                &["WHERE", "GROUP", "ORDER", "LIMIT", "FORMAT", "SETTINGS"],
            )
        {
            return SqlContext::FromClause;
        }

        // Check for SELECT (and no FROM yet)
        if is_keyword_token(token, "SELECT")
            && !has_clause_after(&significant_tokens[i + 1..], &["FROM"])
        {
            return SqlContext::SelectClause;
        }

        // Check for CREATE TABLE ... ( pattern for column definitions
        if matches!(token, Token::LParen)
            && i >= 2
            && is_in_create_table_columns(&significant_tokens, i)
        {
            return SqlContext::ColumnDefinition;
        }
    }

    SqlContext::Default
}

/// Check if we're inside CREATE TABLE column definitions
fn is_in_create_table_columns(tokens: &[&Token], paren_index: usize) -> bool {
    // Look back for CREATE TABLE pattern
    let mut found_table = false;
    let mut found_create = false;
    for j in (0..paren_index).rev() {
        if is_keyword_token(tokens[j], "TABLE") {
            found_table = true;
        } else if is_keyword_token(tokens[j], "CREATE") && found_table {
            found_create = true;
            break;
        }
    }

    if !found_create || !found_table {
        return false;
    }

    // Make sure we haven't closed the paren
    let mut paren_depth = 1;
    for tok in &tokens[paren_index + 1..] {
        match tok {
            Token::LParen => paren_depth += 1,
            Token::RParen => {
                paren_depth -= 1;
                if paren_depth == 0 {
                    return false;
                }
            }
            _ => {}
        }
    }
    paren_depth > 0
}

fn is_keyword_token(token: &Token, keyword: &str) -> bool {
    matches!(token, Token::Word(w) if w.value.eq_ignore_ascii_case(keyword))
}

fn has_clause_after(tokens: &[&Token], keywords: &[&str]) -> bool {
    tokens
        .iter()
        .any(|t| keywords.iter().any(|kw| is_keyword_token(t, kw)))
}

#[derive(Serialize, Deserialize, Debug)]
pub struct InitResult {
    pub success: bool,
    pub error: Option<String>,
}

/// Initialize completion data. Called once at startup.
/// Takes `ClickHouse` data as JSON string.
#[wasm_bindgen]
pub fn init_completion_data(json: &str) -> String {
    let result = match serde_json::from_str::<ClickHouseData>(json) {
        Ok(data) => {
            let cache = build_completion_cache(&data);
            match COMPLETION_CACHE.set(cache) {
                Ok(()) => InitResult {
                    success: true,
                    error: None,
                },
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

/// Get completions for SQL at cursor position.
/// Returns JSON array of `CompletionItem` objects.
#[wasm_bindgen]
pub fn get_completions(sql: &str, cursor_offset: usize) -> String {
    let Some(cache) = COMPLETION_CACHE.get() else {
        return "[]".to_string();
    };

    let context = detect_context(sql, cursor_offset);

    let items: Vec<&CompletionItem> = match context {
        SqlContext::Engine => cache.table_engines.iter().collect(),
        SqlContext::Format => cache.formats.iter().collect(),
        SqlContext::WhereClause => {
            // Return functions + logical operators
            cache
                .functions
                .iter()
                .chain(cache.logical_operators.iter())
                .collect()
        }
        SqlContext::OrderByClause => {
            // Return functions + ORDER BY keywords
            cache
                .functions
                .iter()
                .chain(cache.order_by_keywords.iter())
                .collect()
        }
        SqlContext::SelectClause => cache.functions.iter().collect(),
        SqlContext::FromClause => cache.table_functions.iter().collect(),
        SqlContext::ColumnDefinition => cache.data_types.iter().collect(),
        SqlContext::Settings => cache.settings.iter().collect(),
        SqlContext::Default => cache.all.iter().collect(),
    };

    serde_json::to_string(&items).unwrap_or_else(|_| "[]".to_string())
}

#[must_use]
#[wasm_bindgen]
pub fn validate_sql(sql: &str) -> String {
    let dialect = ClickHouseDialect {};
    let result = match Parser::parse_sql(&dialect, sql) {
        Ok(_) => ValidationResult {
            valid: true,
            error: None,
        },
        Err(e) => {
            // sqlparser errors include position information
            // Format: "sql parser error: Expected X, found Y at Line: 1, Column: 5"
            let message = e.to_string();

            // Parse line/column from error message if available
            let (line, column) = parse_error_position(&message);

            ValidationResult {
                valid: false,
                error: Some(ValidationError {
                    message,
                    line,
                    column,
                }),
            }
        }
    };

    serde_json::to_string(&result).unwrap_or_else(|_| {
        r#"{"valid":false,"error":{"message":"Internal serialization error"}}"#.to_string()
    })
}

#[must_use]
#[wasm_bindgen]
pub fn format_sql(sql: &str) -> String {
    let dialect = ClickHouseDialect {};
    let result = match Parser::parse_sql(&dialect, sql) {
        Ok(statements) => {
            if statements.is_empty() {
                FormatResult {
                    success: false,
                    formatted: None,
                    error: Some("No SQL statements found".to_string()),
                }
            } else {
                // Pretty print with indentation and line breaks using {:#}
                let formatted = statements
                    .iter()
                    .map(|s| format!("{s:#}"))
                    .collect::<Vec<_>>()
                    .join(";\n");
                FormatResult {
                    success: true,
                    formatted: Some(formatted),
                    error: None,
                }
            }
        }
        Err(e) => FormatResult {
            success: false,
            formatted: None,
            error: Some(e.to_string()),
        },
    };

    serde_json::to_string(&result).unwrap_or_else(|_| {
        r#"{"success":false,"error":"Internal serialization error"}"#.to_string()
    })
}

fn parse_error_position(message: &str) -> (Option<u32>, Option<u32>) {
    // Parse "at Line: X, Column: Y" from sqlparser error messages
    let line = message.find("Line: ").and_then(|i| {
        let start = i + 6;
        let end = message[start..]
            .find(',')
            .map_or(message.len(), |j| start + j);
        message[start..end].trim().parse().ok()
    });

    let column = message.find("Column: ").and_then(|i| {
        let start = i + 8;
        let end = message[start..]
            .find(|c: char| !c.is_numeric())
            .map_or(message.len(), |j| start + j);
        message[start..end].trim().parse().ok()
    });

    (line, column)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_select() {
        let sql = "SELECT * FROM users WHERE id = 1";
        let result = validate_sql(sql);
        let parsed: ValidationResult = serde_json::from_str(&result).expect("valid JSON");
        assert!(parsed.valid);
    }

    #[test]
    fn test_invalid_sql() {
        let sql = "SELCT * FROM users";
        let result = validate_sql(sql);
        let parsed: ValidationResult = serde_json::from_str(&result).expect("valid JSON");
        assert!(!parsed.valid);
        assert!(parsed.error.is_some());
    }

    #[test]
    fn test_clickhouse_materialized_view() {
        let sql = "CREATE MATERIALIZED VIEW mv AS SELECT * FROM source";
        let result = validate_sql(sql);
        let parsed: ValidationResult = serde_json::from_str(&result).expect("valid JSON");
        if !parsed.valid {
            eprintln!("Error: {:?}", parsed.error);
        }
        assert!(parsed.valid);
    }

    #[test]
    fn test_format_simple_select() {
        let sql = "select * from users where id=1";
        let result = format_sql(sql);
        let parsed: FormatResult = serde_json::from_str(&result).expect("valid JSON");
        assert!(parsed.success, "Format should succeed: {:?}", parsed.error);
        assert!(parsed.formatted.is_some());
        // sqlparser formats keywords as uppercase
        let formatted = parsed.formatted.expect("formatted should be Some");
        assert!(
            formatted.contains("SELECT"),
            "Should uppercase SELECT: {formatted}"
        );
        assert!(
            formatted.contains("FROM"),
            "Should uppercase FROM: {formatted}"
        );
    }

    #[test]
    fn test_format_invalid_sql_returns_error() {
        let sql = "SELCT * FROM users";
        let result = format_sql(sql);
        let parsed: FormatResult = serde_json::from_str(&result).expect("valid JSON");
        assert!(!parsed.success);
        assert!(parsed.error.is_some());
    }

    #[test]
    fn test_format_preserves_identifiers() {
        let sql = "SELECT _ph_1, _ph_2 FROM _ph_3 WHERE id = _ph_4";
        let result = format_sql(sql);
        let parsed: FormatResult = serde_json::from_str(&result).expect("valid JSON");
        assert!(parsed.success);
        let formatted = parsed.formatted.expect("formatted should be Some");
        assert!(formatted.contains("_ph_1"), "Should preserve _ph_1");
        assert!(formatted.contains("_ph_2"), "Should preserve _ph_2");
        assert!(formatted.contains("_ph_3"), "Should preserve _ph_3");
        assert!(formatted.contains("_ph_4"), "Should preserve _ph_4");
    }

    // Context detection tests
    #[test]
    fn test_detect_context_engine() {
        assert_eq!(
            detect_context("CREATE TABLE t ENGINE = ", 24),
            SqlContext::Engine
        );
        assert_eq!(
            detect_context("CREATE TABLE t ENGINE =", 23),
            SqlContext::Engine
        );
        assert_eq!(detect_context("ENGINE = M", 10), SqlContext::Engine);
    }

    #[test]
    fn test_detect_context_format() {
        assert_eq!(
            detect_context("SELECT * FROM t FORMAT ", 23),
            SqlContext::Format
        );
        assert_eq!(detect_context("SELECT * FORMAT ", 16), SqlContext::Format);
    }

    #[test]
    fn test_detect_context_where() {
        assert_eq!(
            detect_context("SELECT * FROM t WHERE ", 22),
            SqlContext::WhereClause
        );
        assert_eq!(
            detect_context("SELECT * FROM t WHERE x = 1 AND ", 32),
            SqlContext::WhereClause
        );
    }

    #[test]
    fn test_detect_context_having() {
        assert_eq!(
            detect_context("SELECT * FROM t GROUP BY x HAVING ", 34),
            SqlContext::WhereClause
        );
    }

    #[test]
    fn test_detect_context_order_by() {
        assert_eq!(
            detect_context("SELECT * FROM t ORDER BY ", 25),
            SqlContext::OrderByClause
        );
        assert_eq!(
            detect_context("SELECT * FROM t ORDER BY x ", 27),
            SqlContext::OrderByClause
        );
    }

    #[test]
    fn test_detect_context_group_by() {
        assert_eq!(
            detect_context("SELECT * FROM t GROUP BY ", 25),
            SqlContext::OrderByClause
        );
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
        assert_eq!(
            detect_context("SELECT * FROM t SETTINGS ", 25),
            SqlContext::Settings
        );
    }

    #[test]
    fn test_detect_context_default() {
        assert_eq!(detect_context("", 0), SqlContext::Default);
        assert_eq!(detect_context("SEL", 3), SqlContext::Default);
    }

    #[test]
    fn test_detect_context_column_definition() {
        assert_eq!(
            detect_context("CREATE TABLE t (id ", 19),
            SqlContext::ColumnDefinition
        );
        assert_eq!(
            detect_context("CREATE TABLE t (id UInt64, name ", 32),
            SqlContext::ColumnDefinition
        );
    }
}
