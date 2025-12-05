import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Parses ClickHouse version from a Docker image tag.
 *
 * Handles formats:
 * - clickhouse/clickhouse-server:25.8
 * - docker.io/clickhouse/clickhouse-server:25.6
 * - clickhouse/clickhouse-server:${CLICKHOUSE_VERSION:-25.6}
 * - clickhouse/clickhouse-server:25.8.1.1234
 *
 * @returns Normalized version (major.minor) or null if not parseable
 */
export function parseVersionFromImageTag(imageTag: string): string | null {
  // Check if this is a ClickHouse image
  if (!imageTag.includes('clickhouse')) {
    return null;
  }

  // Extract the tag portion after the image name colon
  // Match pattern: image-name:tag where tag doesn't contain / (path separator)
  const imageTagMatch = imageTag.match(/clickhouse-server:([^/]+)$/);
  if (!imageTagMatch) {
    return null;
  }

  let tag = imageTagMatch[1];

  // Handle env var syntax: ${CLICKHOUSE_VERSION:-25.6}
  const envVarMatch = tag.match(/\$\{[^}]+:-([^}]+)\}/);
  if (envVarMatch) {
    tag = envVarMatch[1];
  }

  // Skip non-version tags
  if (tag === 'latest' || tag === 'head') {
    return null;
  }

  // Parse version: expect X.Y or X.Y.Z...
  const versionMatch = tag.match(/^(\d+)\.(\d+)/);
  if (!versionMatch) {
    return null;
  }

  return `${versionMatch[1]}.${versionMatch[2]}`;
}

/**
 * Parses ClickHouse version from docker-compose YAML content.
 *
 * Looks for services named:
 * - clickhousedb (Moose dev)
 * - clickhouse-0 (Moose prod)
 * - clickhouse (generic)
 *
 * @returns Normalized version (major.minor) or null if not found
 */
export function parseVersionFromDockerCompose(
  yamlContent: string,
): string | null {
  // Simple regex-based parsing to avoid adding yaml dependency
  // Look for image: lines under clickhouse-related services

  const servicePatterns = [
    /clickhousedb:\s*\n(?:[^\n]*\n)*?\s*image:\s*([^\n]+)/i,
    /clickhouse-0:\s*\n(?:[^\n]*\n)*?\s*image:\s*([^\n]+)/i,
    /clickhouse:\s*\n(?:[^\n]*\n)*?\s*image:\s*([^\n]+)/i,
  ];

  for (const pattern of servicePatterns) {
    const match = yamlContent.match(pattern);
    if (match) {
      const version = parseVersionFromImageTag(match[1].trim());
      if (version) {
        return version;
      }
    }
  }

  // Fallback: look for any clickhouse-server image line
  const imageMatch = yamlContent.match(
    /image:\s*([^\n]*clickhouse-server[^\n]*)/i,
  );
  if (imageMatch) {
    return parseVersionFromImageTag(imageMatch[1].trim());
  }

  return null;
}

/**
 * Finds the best matching version from available versions.
 *
 * Priority:
 * 1. Exact match
 * 2. Same major version, closest minor (prefer lower)
 * 3. Latest available version
 *
 * @param detected - The detected version (e.g., "25.7", "25.6.9")
 * @param available - Array of available versions (e.g., ["25.6", "25.8"])
 * @returns The best matching available version
 */
export function findBestMatchingVersion(
  detected: string,
  available: string[],
): string {
  if (available.length === 0) {
    throw new Error('No available versions provided');
  }

  // Normalize detected version to major.minor
  const [detectedMajor, detectedMinor] = detected.split('.').map(Number);
  const normalizedDetected = `${detectedMajor}.${detectedMinor}`;

  // Exact match
  if (available.includes(normalizedDetected)) {
    return normalizedDetected;
  }

  // Find candidates with same major version
  const sameMajor = available.filter((v) => {
    const [major] = v.split('.').map(Number);
    return major === detectedMajor;
  });

  if (sameMajor.length > 0) {
    // Sort by minor version
    const sorted = sameMajor.sort((a, b) => {
      const [, aMinor] = a.split('.').map(Number);
      const [, bMinor] = b.split('.').map(Number);
      return aMinor - bMinor;
    });

    // Find closest lower or equal
    let closest = sorted[0];
    for (const v of sorted) {
      const [, minor] = v.split('.').map(Number);
      if (minor <= detectedMinor) {
        closest = v;
      } else {
        break;
      }
    }

    // If no lower version exists, return the lowest in same major
    return closest;
  }

  // No same major version, return latest overall
  const sorted = [...available].sort((a, b) => {
    const [aMajor, aMinor] = a.split('.').map(Number);
    const [bMajor, bMinor] = b.split('.').map(Number);
    if (aMajor !== bMajor) return bMajor - aMajor;
    return bMinor - aMinor;
  });

  return sorted[0];
}

/**
 * Detects ClickHouse version from a Moose project.
 *
 * Checks in order:
 * 1. docker-compose.dev.override.yaml (user override)
 * 2. .moose/docker-compose.yml (generated)
 *
 * @param projectRoot - Path to the Moose project root
 * @returns Detected version or null if not found
 */
export async function detectClickHouseVersion(
  projectRoot: string,
): Promise<string | null> {
  const filesToCheck = [
    path.join(projectRoot, 'docker-compose.dev.override.yaml'),
    path.join(projectRoot, 'docker-compose.dev.override.yml'),
    path.join(projectRoot, '.moose', 'docker-compose.yml'),
    path.join(projectRoot, '.moose', 'docker-compose.yaml'),
  ];

  for (const filePath of filesToCheck) {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const version = parseVersionFromDockerCompose(content);
      if (version) {
        return version;
      }
    } catch {
      // File doesn't exist or can't be read, try next
    }
  }

  return null;
}
