import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';

/**
 * Detects a Moose project by searching for package.json files containing @514labs/moose-lib
 * Supports monorepos by recursively searching subdirectories
 */
export async function detectMooseProject(
  workspaceRoot: string,
): Promise<string | null> {
  try {
    // Find all package.json files in workspace
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
          // Return the directory containing this package.json
          return path.dirname(fullPath);
        }
      } catch (_error) {}
    }

    return null;
  } catch (error) {
    console.error('Error detecting Moose project:', error);
    return null;
  }
}
