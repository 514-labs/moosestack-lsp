import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { glob } from 'glob';
import {
  extractAllPythonSqlLocations,
  extractPythonSqlLocations,
} from './pythonSqlExtractor';
import type { SqlLocation } from './sqlLocations';

/**
 * Represents a parsed Python file in memory.
 */
interface PythonFile {
  path: string;
  content: string;
}

/**
 * Service that manages Python files for SQL extraction.
 * Holds files in memory for fast incremental updates.
 */
export interface PythonService {
  /** Initialize with project root path. Scans for Python files. */
  initialize(projectRoot: string): Promise<void>;

  /** Update file content in cache. */
  updateFile(filePath: string, content: string): void;

  /** Get all Python files (for initial scan). */
  getFiles(): PythonFile[];

  /** Get specific file by path. */
  getFile(filePath: string): PythonFile | undefined;

  /** Extract SQL locations from a specific file. */
  extractSqlLocations(filePath: string): SqlLocation[];

  /** Extract SQL locations from all files. */
  extractAllSqlLocations(): SqlLocation[];

  /** Check if service is initialized and healthy. */
  isHealthy(): boolean;

  /** Get initialization error if any. */
  getError(): string | null;

  /** Get the project root. */
  getProjectRoot(): string | null;
}

/**
 * Creates a Python service that manages Python file lifecycle.
 * Maintains an in-memory cache for fast updates on file changes.
 */
export function createPythonService(): PythonService {
  let projectRoot: string | null = null;
  const fileCache = new Map<string, PythonFile>(); // In-memory file cache
  let error: string | null = null;
  let initialized = false;

  return {
    async initialize(root: string): Promise<void> {
      try {
        projectRoot = root;

        // Find all Python files in project (excluding common ignored directories)
        const pythonFiles = await glob('**/*.py', {
          cwd: root,
          ignore: [
            '**/node_modules/**',
            '**/.venv/**',
            '**/venv/**',
            '**/__pycache__/**',
            '**/dist/**',
            '**/build/**',
            '**/.git/**',
            '**/target/**',
            '**/.moose/**',
          ],
          absolute: true,
        });

        // Load all files into cache
        for (const filePath of pythonFiles) {
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const normalizedPath = path.normalize(filePath);
            fileCache.set(normalizedPath, {
              path: normalizedPath,
              content,
            });
          } catch {
            // Skip files that can't be read
          }
        }

        initialized = true;
        error = null;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        initialized = false;
      }
    },

    updateFile(filePath: string, content: string): void {
      const normalizedPath = path.normalize(filePath);
      fileCache.set(normalizedPath, {
        path: normalizedPath,
        content,
      });
    },

    getFiles(): PythonFile[] {
      return Array.from(fileCache.values());
    },

    getFile(filePath: string): PythonFile | undefined {
      const normalizedPath = path.normalize(filePath);
      return fileCache.get(normalizedPath);
    },

    extractSqlLocations(filePath: string): SqlLocation[] {
      const file = this.getFile(filePath);
      if (!file) return [];
      return extractPythonSqlLocations(file.content, file.path);
    },

    extractAllSqlLocations(): SqlLocation[] {
      const files = this.getFiles().map((f) => ({
        path: f.path,
        content: f.content,
      }));
      return extractAllPythonSqlLocations(files);
    },

    isHealthy(): boolean {
      return initialized && error === null;
    },

    getError(): string | null {
      return error;
    },

    getProjectRoot(): string | null {
      return projectRoot;
    },
  };
}
