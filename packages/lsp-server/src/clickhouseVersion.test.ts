import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  findBestMatchingVersion,
  parseVersionFromDockerCompose,
  parseVersionFromImageTag,
} from './clickhouseVersion';

describe('clickhouseVersion', () => {
  describe('parseVersionFromImageTag', () => {
    it('parses simple version tag', () => {
      assert.strictEqual(
        parseVersionFromImageTag('clickhouse/clickhouse-server:25.8'),
        '25.8',
      );
    });

    it('parses version with patch number', () => {
      assert.strictEqual(
        parseVersionFromImageTag('clickhouse/clickhouse-server:25.8.1'),
        '25.8',
      );
    });

    it('parses docker.io prefixed image', () => {
      assert.strictEqual(
        parseVersionFromImageTag('docker.io/clickhouse/clickhouse-server:25.6'),
        '25.6',
      );
    });

    it('extracts default from env var syntax', () => {
      assert.strictEqual(
        parseVersionFromImageTag(
          'clickhouse/clickhouse-server:${CLICKHOUSE_VERSION:-25.6}',
        ),
        '25.6',
      );
    });

    it('returns null for unrecognized format', () => {
      assert.strictEqual(
        parseVersionFromImageTag('some-other-image:latest'),
        null,
      );
    });

    it('returns null for latest tag', () => {
      assert.strictEqual(
        parseVersionFromImageTag('clickhouse/clickhouse-server:latest'),
        null,
      );
    });
  });

  describe('parseVersionFromDockerCompose', () => {
    it('extracts version from clickhousedb service', () => {
      const yaml = `
services:
  clickhousedb:
    image: docker.io/clickhouse/clickhouse-server:\${CLICKHOUSE_VERSION:-25.6}
`;
      assert.strictEqual(parseVersionFromDockerCompose(yaml), '25.6');
    });

    it('extracts version from clickhouse-0 service', () => {
      const yaml = `
services:
  clickhouse-0:
    image: clickhouse/clickhouse-server:25.8
`;
      assert.strictEqual(parseVersionFromDockerCompose(yaml), '25.8');
    });

    it('returns null when no clickhouse service found', () => {
      const yaml = `
services:
  redis:
    image: redis:latest
`;
      assert.strictEqual(parseVersionFromDockerCompose(yaml), null);
    });
  });

  describe('findBestMatchingVersion', () => {
    const available = ['25.6', '25.8'];

    it('returns exact match when available', () => {
      assert.strictEqual(findBestMatchingVersion('25.8', available), '25.8');
    });

    it('returns closest lower version for unknown minor', () => {
      assert.strictEqual(findBestMatchingVersion('25.7', available), '25.6');
    });

    it('returns closest higher version when no lower exists', () => {
      assert.strictEqual(findBestMatchingVersion('25.5', available), '25.6');
    });

    it('returns latest when major version differs', () => {
      assert.strictEqual(findBestMatchingVersion('24.0', available), '25.8');
    });

    it('handles patch versions by matching minor', () => {
      assert.strictEqual(findBestMatchingVersion('25.6.9', available), '25.6');
    });
  });
});
