import * as fs from 'node:fs';
import * as path from 'node:path';
import { findBestMatchingVersion } from './clickhouseVersion';

export interface FunctionInfo {
  name: string;
  isAggregate: boolean;
  caseInsensitive: boolean;
  aliasTo: string | null;
  syntax: string;
  description: string;
  arguments: string;
  returnedValue: string;
  examples: string;
  categories: string;
}

export interface DataTypeInfo {
  name: string;
  caseInsensitive: boolean;
  aliasTo: string | null;
}

export interface TableEngineInfo {
  name: string;
  supportsSettings: boolean;
  supportsSkippingIndices: boolean;
  supportsProjections: boolean;
  supportsSortOrder: boolean;
  supportsTTL: boolean;
  supportsReplication: boolean;
  supportsDeduplication: boolean;
  supportsParallelInsert: boolean;
}

export interface FormatInfo {
  name: string;
  isInput: boolean;
  isOutput: boolean;
}

export interface TableFunctionInfo {
  name: string;
  description: string;
}

export interface SettingInfo {
  name: string;
  type: string;
  description: string;
}

export interface ClickHouseData {
  version: string;
  extractedAt: string;
  functions: FunctionInfo[];
  keywords: string[];
  dataTypes: DataTypeInfo[];
  tableEngines: TableEngineInfo[];
  formats: FormatInfo[];
  tableFunctions: TableFunctionInfo[];
  aggregateCombinators: string[];
  settings: SettingInfo[];
  mergeTreeSettings: SettingInfo[];
  /** Warning message if loaded version differs from requested */
  warning?: string;
}

// Cache for loaded data
const dataCache = new Map<string, ClickHouseData>();

// Data directory path - works in both dev (src) and built (dist) contexts
function getDataDirectory(): string {
  // Try multiple possible locations
  const possiblePaths = [
    path.join(__dirname, 'data'),
    path.join(__dirname, '..', 'src', 'data'),
    path.join(__dirname, '..', 'data'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Default to first option
  return possiblePaths[0];
}

/**
 * Returns list of available ClickHouse versions (from data files).
 * Versions are sorted in descending order (newest first).
 */
export function getAvailableVersions(): string[] {
  const dataDir = getDataDirectory();

  try {
    const files = fs.readdirSync(dataDir);
    const versions = files
      .filter((f) => f.startsWith('clickhouse-') && f.endsWith('.json'))
      .map((f) => f.replace('clickhouse-', '').replace('.json', ''))
      .sort((a, b) => {
        const [aMajor, aMinor] = a.split('.').map(Number);
        const [bMajor, bMinor] = b.split('.').map(Number);
        if (aMajor !== bMajor) return bMajor - aMajor;
        return bMinor - aMinor;
      });

    return versions;
  } catch {
    return [];
  }
}

/**
 * Loads ClickHouse data for the specified version.
 *
 * If exact version is not available, loads the closest matching version
 * and includes a warning in the result.
 *
 * @param requestedVersion - The requested ClickHouse version (e.g., "25.8", "25.6.9")
 * @returns ClickHouse data with optional warning if version was substituted
 */
export async function loadClickHouseData(
  requestedVersion: string,
): Promise<ClickHouseData> {
  const availableVersions = getAvailableVersions();

  if (availableVersions.length === 0) {
    throw new Error('No ClickHouse data files found');
  }

  // Normalize requested version to major.minor
  const [major, minor] = requestedVersion.split('.');
  const normalizedRequested = `${major}.${minor}`;

  // Find best matching version
  const matchedVersion = findBestMatchingVersion(
    normalizedRequested,
    availableVersions,
  );

  // Check cache
  if (dataCache.has(matchedVersion)) {
    const cached = dataCache.get(matchedVersion)!;
    // Add warning if version differs
    if (matchedVersion !== normalizedRequested) {
      return {
        ...cached,
        warning: `Requested version ${requestedVersion} not found, using ${matchedVersion} instead`,
      };
    }
    return cached;
  }

  // Load from file
  const dataDir = getDataDirectory();
  const filePath = path.join(dataDir, `clickhouse-${matchedVersion}.json`);

  const content = await fs.promises.readFile(filePath, 'utf-8');
  const data: ClickHouseData = JSON.parse(content);

  // Cache it
  dataCache.set(matchedVersion, data);

  // Add warning if version differs
  if (matchedVersion !== normalizedRequested) {
    return {
      ...data,
      warning: `Requested version ${requestedVersion} not found, using ${matchedVersion} instead`,
    };
  }

  return data;
}

/**
 * Clears the data cache. Useful for testing.
 */
export function clearDataCache(): void {
  dataCache.clear();
}
