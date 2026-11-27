import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { translateSql } = require("../server/db/sql-translate.cjs") as {
  translateSql: (sql: string, paramCount?: number, isBatch?: boolean) => string;
};

describe("Postgres SQL translation", () => {
  it("keeps SQLite date(column) comparisons text-compatible with date('now')", () => {
    const sql = translateSql(`
      SELECT COUNT(*) FROM product_certificates c
      WHERE date(c.valid_to) >= date('now')
        AND date(c.valid_to) <= date('now', '+30 day')
    `);

    assert.match(
      sql,
      /to_char\(\(c\.valid_to\)::date, 'YYYY-MM-DD'\) >= to_char\(CURRENT_TIMESTAMP, 'YYYY-MM-DD'\)/
    );
    assert.match(
      sql,
      /to_char\(\(c\.valid_to\)::date, 'YYYY-MM-DD'\) <= to_char\(CURRENT_TIMESTAMP \+ INTERVAL '30 day', 'YYYY-MM-DD'\)/
    );
  });

  it("leaves date('now') inserts as text for TEXT date columns", () => {
    const sql = translateSql("INSERT INTO lots (expiry_date) VALUES (date('now'))", 0);
    assert.equal(sql, "INSERT INTO lots (expiry_date) VALUES (to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD'))");
  });
});
