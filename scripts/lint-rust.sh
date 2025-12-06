#!/bin/bash
# Run clippy on Rust files when any .rs file is staged
# This script is called by lint-staged

# Run clippy with auto-fix where possible, then check for remaining errors
# --fix applies safe fixes automatically
# --allow-dirty is needed because we're in a pre-commit hook with staged changes
cargo clippy --all-targets --workspace --fix --allow-dirty --allow-staged 2>/dev/null

# Now run clippy again to check for any remaining errors (unfixable ones)
# -D warnings treats all warnings as errors (matches CI behavior)
cargo clippy --all-targets --workspace -- -D warnings
