import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  extractAllPythonSqlLocations,
  extractPythonSqlLocations,
} from './pythonSqlExtractor';

describe('pythonSqlExtractor', () => {
  describe('extractPythonSqlLocations', () => {
    it('extracts sql() function call with simple string', () => {
      const code = `
from moose_lib import sql

query = sql("SELECT * FROM users")
`;
      const locations = extractPythonSqlLocations(code, '/test/file.py');

      assert.strictEqual(locations.length, 1);
      assert.strictEqual(locations[0].templateText, 'SELECT * FROM users');
      assert.strictEqual(locations[0].file, '/test/file.py');
    });

    it('extracts sql() function call with triple-quoted string', () => {
      const code = `
from moose_lib import sql

query = sql("""
    SELECT *
    FROM users
    WHERE active = true
""")
`;
      const locations = extractPythonSqlLocations(code, '/test/file.py');

      assert.strictEqual(locations.length, 1);
      assert.ok(locations[0].templateText.includes('SELECT *'));
      assert.ok(locations[0].templateText.includes('FROM users'));
    });

    it('extracts multiple sql() calls from same file', () => {
      const code = `
from moose_lib import sql

query1 = sql("SELECT * FROM users")
query2 = sql("SELECT * FROM orders")
query3 = sql("SELECT * FROM products")
`;
      const locations = extractPythonSqlLocations(code, '/test/file.py');

      assert.strictEqual(locations.length, 3);
      assert.strictEqual(locations[0].templateText, 'SELECT * FROM users');
      assert.strictEqual(locations[1].templateText, 'SELECT * FROM orders');
      assert.strictEqual(locations[2].templateText, 'SELECT * FROM products');
    });

    it('extracts f-string with :col format specifier', () => {
      const code = `
from moose_lib import MooseModel

class User(MooseModel):
    user_id: int
    email: str

query = f"SELECT {User.user_id:col}, {User.email:col} FROM users"
`;
      const locations = extractPythonSqlLocations(code, '/test/file.py');

      assert.strictEqual(locations.length, 1);
      // Interpolations should be replaced with ${...}
      assert.strictEqual(
        locations[0].templateText,
        'SELECT ${...}, ${...} FROM users',
      );
    });

    it('extracts sql() with f-string argument', () => {
      const code = `
from moose_lib import sql

table_name = "users"
query = sql(f"SELECT * FROM {table_name}")
`;
      const locations = extractPythonSqlLocations(code, '/test/file.py');

      assert.strictEqual(locations.length, 1);
      assert.strictEqual(locations[0].templateText, 'SELECT * FROM ${...}');
    });

    it('returns empty array for file without sql patterns', () => {
      const code = `
def hello():
    print("Hello, World!")

x = 1 + 2
`;
      const locations = extractPythonSqlLocations(code, '/test/file.py');

      assert.strictEqual(locations.length, 0);
    });

    it('ignores f-strings without :col that do not look like SQL', () => {
      const code = `
name = "Alice"
greeting = f"Hello, {name}!"
`;
      const locations = extractPythonSqlLocations(code, '/test/file.py');

      // Should not extract this as it's not SQL
      assert.strictEqual(locations.length, 0);
    });

    it('handles attribute access sql calls like moose_lib.sql()', () => {
      const code = `
import moose_lib

query = moose_lib.sql("SELECT * FROM users")
`;
      const locations = extractPythonSqlLocations(code, '/test/file.py');

      assert.strictEqual(locations.length, 1);
      assert.strictEqual(locations[0].templateText, 'SELECT * FROM users');
    });

    it('extracts correct line and column positions', () => {
      const code = `from moose_lib import sql

query = sql("SELECT * FROM users")
`;
      const locations = extractPythonSqlLocations(code, '/test/file.py');

      assert.strictEqual(locations.length, 1);
      assert.strictEqual(locations[0].line, 3);
      assert.ok(locations[0].column > 0);
    });

    it('generates unique IDs for each location', () => {
      const code = `
from moose_lib import sql

query1 = sql("SELECT * FROM users")
query2 = sql("SELECT * FROM orders")
`;
      const locations = extractPythonSqlLocations(code, '/test/file.py');

      assert.strictEqual(locations.length, 2);
      assert.notStrictEqual(locations[0].id, locations[1].id);
    });
  });

  describe('extractAllPythonSqlLocations', () => {
    it('extracts sql from multiple files', () => {
      const files = [
        {
          path: '/test/queries/users.py',
          content: `
from moose_lib import sql
users_query = sql("SELECT * FROM users")
`,
        },
        {
          path: '/test/queries/orders.py',
          content: `
from moose_lib import sql
orders_query = sql("SELECT * FROM orders")
`,
        },
      ];

      const locations = extractAllPythonSqlLocations(files);

      assert.strictEqual(locations.length, 2);

      const templates = locations.map((l) => l.templateText);
      assert.ok(templates.includes('SELECT * FROM users'));
      assert.ok(templates.includes('SELECT * FROM orders'));
    });

    it('returns empty array for empty file list', () => {
      const locations = extractAllPythonSqlLocations([]);
      assert.strictEqual(locations.length, 0);
    });

    it('skips files without sql patterns', () => {
      const files = [
        {
          path: '/test/utils.py',
          content: `
def helper():
    return 42
`,
        },
        {
          path: '/test/queries.py',
          content: `
from moose_lib import sql
query = sql("SELECT * FROM users")
`,
        },
      ];

      const locations = extractAllPythonSqlLocations(files);

      assert.strictEqual(locations.length, 1);
      assert.strictEqual(locations[0].templateText, 'SELECT * FROM users');
    });
  });
});
