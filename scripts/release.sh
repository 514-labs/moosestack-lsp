#!/usr/bin/env bash

set -eo pipefail

# This script should be called from the root of the repository
version=$1

if [ -z "$version" ]; then
  echo "Error: Version argument required"
  echo "Usage: $0 <version>"
  exit 1
fi

echo "Releasing version: $version"

# Update lsp-server package.json version (skip if already at target version)
lsp_current_version=$(node -p "require('./packages/lsp-server/package.json').version")
if [ "$lsp_current_version" != "$version" ]; then
  echo "Updating lsp-server version from $lsp_current_version to $version"
  cd packages/lsp-server
  npm version $version --no-git-tag-version
  cd ../..
fi

# Install dependencies
echo "Installing dependencies..."
pnpm install

# Run linting first
echo "Running lint..."
pnpm lint

# Build the packages
echo "Building packages..."
pnpm build

# Run tests to ensure everything passes
echo "Running tests..."
pnpm test

# Publish lsp-server to npm with 'latest' tag
echo "Publishing @514labs/moose-lsp to npm..."
cd packages/lsp-server
npm publish --access public
cd ../..

echo "Release complete!"
