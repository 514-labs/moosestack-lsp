use serde::{Deserialize, Serialize};
use sqlparser::dialect::ClickHouseDialect;
use sqlparser::parser::Parser;
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
}
