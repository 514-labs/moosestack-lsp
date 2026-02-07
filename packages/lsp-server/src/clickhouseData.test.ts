import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { getAvailableVersions, loadClickHouseData } from './clickhouseData';

describe('clickhouseData', () => {
  describe('getAvailableVersions', () => {
    it('returns array of available versions', () => {
      const versions = getAvailableVersions();
      assert.ok(Array.isArray(versions));
      assert.ok(versions.length > 0);
      // Should include our generated versions
      assert.ok(versions.includes('25.6') || versions.includes('25.8'));
    });

    it('returns versions sorted in descending order', () => {
      const versions = getAvailableVersions();
      for (let i = 0; i < versions.length - 1; i++) {
        const [aMajor, aMinor] = versions[i].split('.').map(Number);
        const [bMajor, bMinor] = versions[i + 1].split('.').map(Number);
        assert.ok(
          aMajor > bMajor || (aMajor === bMajor && aMinor >= bMinor),
          `Expected ${versions[i]} >= ${versions[i + 1]}`,
        );
      }
    });
  });

  describe('loadClickHouseData', () => {
    it('loads data for exact version match', async () => {
      const versions = getAvailableVersions();
      if (versions.length === 0) {
        // Skip if no data files exist yet
        return;
      }

      const data = await loadClickHouseData(versions[0]);

      assert.ok(data);
      assert.strictEqual(data.version, versions[0]);
      assert.ok(Array.isArray(data.functions));
      assert.ok(Array.isArray(data.keywords));
      assert.ok(data.functions.length > 0);
      assert.ok(data.keywords.length > 0);
    });

    it('loads closest version when exact match not found', async () => {
      const data = await loadClickHouseData('25.7');

      assert.ok(data);
      // Should load either 25.6 or 25.8, whichever is closest
      assert.ok(['25.6', '25.8'].includes(data.version));
    });

    it('returns warning when version is not exact match', async () => {
      const data = await loadClickHouseData('25.7');

      assert.ok(data);
      assert.ok(data.warning);
      assert.ok(data.warning.includes('25.7'));
    });

    it('data structure has expected properties', async () => {
      const versions = getAvailableVersions();
      if (versions.length === 0) {
        return;
      }

      const data = await loadClickHouseData(versions[0]);

      // Check structure
      assert.ok(typeof data.version === 'string');
      assert.ok(typeof data.extractedAt === 'string');
      assert.ok(Array.isArray(data.functions));
      assert.ok(Array.isArray(data.keywords));
      assert.ok(Array.isArray(data.dataTypes));
      assert.ok(Array.isArray(data.tableEngines));
      assert.ok(Array.isArray(data.formats));
      assert.ok(Array.isArray(data.tableFunctions));
      assert.ok(Array.isArray(data.aggregateCombinators));
      assert.ok(Array.isArray(data.settings));
      assert.ok(Array.isArray(data.mergeTreeSettings));
    });

    it('includes expanded combinator functions and first-word keyword aliases', async () => {
      const versions = getAvailableVersions();
      if (versions.length === 0) {
        return;
      }

      const data = await loadClickHouseData(versions[0]);

      assert.ok(
        data.functions.some((f) => f.name === 'sumIf'),
        'Expected generated data to include sumIf',
      );
      assert.ok(
        data.keywords.includes('GROUP'),
        'Expected generated data to include GROUP keyword alias',
      );
    });
  });
});
