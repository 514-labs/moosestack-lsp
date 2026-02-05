import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';

/**
 * Result of project detection, indicating both the root and the type of project.
 */
export interface MooseProjectInfo {
  root: string;
  type: 'typescript' | 'python' | 'both';
}

/**
 * Detects a Moose TypeScript project by searching for package.json containing @514labs/moose-lib
 */
async function detectTypeScriptMooseProject(
  workspaceRoot: string,
): Promise<string | null> {
  const packageJsonPaths = await glob('**/package.json', {
    cwd: workspaceRoot,
    ignore: ['**/node_modules/**', '**/dist/**', '**/target/**'],
  });

  for (const relativePath of packageJsonPaths) {
    const fullPath = path.join(workspaceRoot, relativePath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      const pkg = JSON.parse(content);

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['@514labs/moose-lib']) {
        return path.dirname(fullPath);
      }
    } catch {
      // Skip files that can't be read or parsed
    }
  }

  return null;
}

/**
 * Detects a Moose Python project by searching for pyproject.toml or requirements.txt containing moose-lib
 */
async function detectPythonMooseProject(
  workspaceRoot: string,
): Promise<string | null> {
  // Check pyproject.toml files
  const pyprojectPaths = await glob('**/pyproject.toml', {
    cwd: workspaceRoot,
    ignore: [
      '**/node_modules/**',
      '**/.venv/**',
      '**/venv/**',
      '**/dist/**',
      '**/target/**',
    ],
  });

  for (const relativePath of pyprojectPaths) {
    const fullPath = path.join(workspaceRoot, relativePath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      // Check if moose-lib is mentioned in pyproject.toml
      if (content.includes('moose-lib') || content.includes('moose_lib')) {
        return path.dirname(fullPath);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Check requirements.txt files
  const requirementsPaths = await glob('**/requirements*.txt', {
    cwd: workspaceRoot,
    ignore: [
      '**/node_modules/**',
      '**/.venv/**',
      '**/venv/**',
      '**/dist/**',
      '**/target/**',
    ],
  });

  for (const relativePath of requirementsPaths) {
    const fullPath = path.join(workspaceRoot, relativePath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      // Check if moose-lib is listed as a dependency
      if (content.includes('moose-lib') || content.includes('moose_lib')) {
        return path.dirname(fullPath);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Check setup.py files
  const setupPyPaths = await glob('**/setup.py', {
    cwd: workspaceRoot,
    ignore: [
      '**/node_modules/**',
      '**/.venv/**',
      '**/venv/**',
      '**/dist/**',
      '**/target/**',
    ],
  });

  for (const relativePath of setupPyPaths) {
    const fullPath = path.join(workspaceRoot, relativePath);

    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      if (content.includes('moose-lib') || content.includes('moose_lib')) {
        return path.dirname(fullPath);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return null;
}

/**
 * Detects a Moose project by searching for package.json files containing @514labs/moose-lib
 * or Python project files containing moose-lib.
 * Supports monorepos by recursively searching subdirectories.
 * Returns the first project root found (prefers TypeScript, then Python).
 */
export async function detectMooseProject(
  workspaceRoot: string,
): Promise<string | null> {
  try {
    // Try TypeScript first
    const tsRoot = await detectTypeScriptMooseProject(workspaceRoot);
    if (tsRoot) return tsRoot;

    // Try Python
    const pyRoot = await detectPythonMooseProject(workspaceRoot);
    if (pyRoot) return pyRoot;

    return null;
  } catch (error) {
    console.error('Error detecting Moose project:', error);
    return null;
  }
}

/**
 * Detects Moose project with detailed information about project type.
 * Returns project info including whether it's TypeScript, Python, or both.
 */
export async function detectMooseProjectWithInfo(
  workspaceRoot: string,
): Promise<MooseProjectInfo | null> {
  try {
    const tsRoot = await detectTypeScriptMooseProject(workspaceRoot);
    const pyRoot = await detectPythonMooseProject(workspaceRoot);

    if (tsRoot && pyRoot) {
      // Both found - use the more specific (deeper) root, or TypeScript if same
      if (tsRoot.startsWith(pyRoot)) {
        return { root: tsRoot, type: 'both' };
      }
      if (pyRoot.startsWith(tsRoot)) {
        return { root: pyRoot, type: 'both' };
      }
      // Different roots - prefer TypeScript
      return { root: tsRoot, type: 'typescript' };
    }

    if (tsRoot) {
      return { root: tsRoot, type: 'typescript' };
    }

    if (pyRoot) {
      return { root: pyRoot, type: 'python' };
    }

    return null;
  } catch (error) {
    console.error('Error detecting Moose project:', error);
    return null;
  }
}
