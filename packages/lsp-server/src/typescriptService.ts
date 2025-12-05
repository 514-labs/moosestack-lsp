import * as path from 'node:path';
import ts from 'typescript';

/**
 * Service that manages a TypeScript Program lifecycle for SQL extraction.
 * Holds the Program and TypeChecker in memory for fast incremental updates.
 */
export interface TypeScriptService {
  /** Initialize with tsconfig.json path. Builds initial Program. */
  initialize(tsconfigPath: string): void;

  /** Update file content, rebuild program incrementally. */
  updateFile(filePath: string, content: string): void;

  /** Get TypeChecker for symbol resolution. */
  getTypeChecker(): ts.TypeChecker;

  /** Get all source files (for initial scan). Excludes declaration files and node_modules. */
  getSourceFiles(): readonly ts.SourceFile[];

  /** Get specific source file by path. */
  getSourceFile(filePath: string): ts.SourceFile | undefined;

  /** Check if service is initialized and healthy. */
  isHealthy(): boolean;

  /** Get initialization error if any. */
  getError(): string | null;
}

/**
 * Creates a TypeScript service that manages Program lifecycle.
 * Uses incremental compilation for fast updates on file changes.
 */
export function createTypeScriptService(): TypeScriptService {
  let program: ts.Program | null = null;
  let compilerOptions: ts.CompilerOptions = {};
  let rootFiles: string[] = [];
  const fileContents = new Map<string, string>(); // In-memory file cache
  let error: string | null = null;

  /**
   * Creates a custom CompilerHost that uses our in-memory cache.
   * Falls back to disk for files not in cache.
   */
  const createCompilerHost = (): ts.CompilerHost => {
    const defaultHost = ts.createCompilerHost(compilerOptions);
    return {
      ...defaultHost,
      getSourceFile: (
        fileName: string,
        languageVersion: ts.ScriptTarget,
        onError?: (message: string) => void,
      ): ts.SourceFile | undefined => {
        // Check our cache first
        const normalizedPath = path.normalize(fileName);
        const cached = fileContents.get(normalizedPath);
        if (cached !== undefined) {
          return ts.createSourceFile(fileName, cached, languageVersion);
        }
        // Fall back to disk
        return defaultHost.getSourceFile(fileName, languageVersion, onError);
      },
      fileExists: (fileName: string): boolean => {
        const normalizedPath = path.normalize(fileName);
        if (fileContents.has(normalizedPath)) return true;
        return defaultHost.fileExists(fileName);
      },
      readFile: (fileName: string): string | undefined => {
        const normalizedPath = path.normalize(fileName);
        const cached = fileContents.get(normalizedPath);
        if (cached !== undefined) return cached;
        return defaultHost.readFile(fileName);
      },
    };
  };

  return {
    initialize(tsconfigPath: string): void {
      try {
        const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        if (configFile.error) {
          error = ts.flattenDiagnosticMessageText(
            configFile.error.messageText,
            '\n',
          );
          return;
        }

        const projectRoot = path.dirname(tsconfigPath);
        const parsed = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          projectRoot,
        );

        if (parsed.errors.length > 0) {
          error = parsed.errors
            .map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n'))
            .join('\n');
          return;
        }

        compilerOptions = parsed.options;
        rootFiles = parsed.fileNames;

        program = ts.createProgram({
          rootNames: rootFiles,
          options: compilerOptions,
          host: createCompilerHost(),
        });

        error = null;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    },

    updateFile(filePath: string, content: string): void {
      if (!program) return;

      const normalizedPath = path.normalize(filePath);
      fileContents.set(normalizedPath, content);

      // Rebuild program incrementally using oldProgram
      program = ts.createProgram({
        rootNames: rootFiles,
        options: compilerOptions,
        host: createCompilerHost(),
        oldProgram: program,
      });
    },

    getTypeChecker(): ts.TypeChecker {
      if (!program) throw new Error('TypeScript service not initialized');
      return program.getTypeChecker();
    },

    getSourceFiles(): readonly ts.SourceFile[] {
      if (!program) return [];
      // Filter out declaration files and node_modules
      return program.getSourceFiles().filter((sf) => {
        return !sf.isDeclarationFile && !sf.fileName.includes('node_modules');
      });
    },

    getSourceFile(filePath: string): ts.SourceFile | undefined {
      if (!program) return undefined;
      return program.getSourceFile(path.normalize(filePath));
    },

    isHealthy(): boolean {
      return program !== null && error === null;
    },

    getError(): string | null {
      return error;
    },
  };
}
