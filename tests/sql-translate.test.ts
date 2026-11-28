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

  it("translates scalar MAX(a, b) to GREATEST without breaking aggregate MAX", () => {
    const sql = translateSql(
      "SELECT MAX(created_at) AS last_at, MAX(0, current_exposure_cents - ?) AS exposure FROM customers WHERE id = ?",
      2
    );

    assert.match(sql, /MAX\(created_at\) AS last_at/);
    assert.doesNotMatch(sql, /MAX\(0,/);
    assert.match(sql, /GREATEST\(0, current_exposure_cents - \$1\)/);
    assert.match(sql, /\(0\) IS NULL OR \(current_exposure_cents - \$1\) IS NULL/);
    assert.match(sql, /WHERE id = \$2/);
  });

  it("translates nested scalar min/max with multiple arguments", () => {
    const sql = translateSql(
      "SELECT MIN(MAX(0, quantity_cases - allocated_cases), received_cases) AS available FROM lots",
      0
    );

    assert.match(sql, /LEAST\(CASE WHEN \(0\) IS NULL OR \(quantity_cases - allocated_cases\) IS NULL THEN NULL ELSE GREATEST\(0, quantity_cases - allocated_cases\) END, received_cases\)/);
    assert.doesNotMatch(sql, /\b(?:MIN|MAX)\(/);
  });

  it("translates julianday(column) using the column, not a stray $1 placeholder", () => {
    const sql = translateSql(
      "SELECT julianday('now') - julianday(il.received_date) FROM inventory_lots il",
      0
    );

    assert.match(sql, /EXTRACT\(EPOCH FROM \(il\.received_date\)::timestamp\)/);
    assert.doesNotMatch(sql, /\$1/);
  });

  it("keeps deleteOrder's reservation release executable on Postgres", () => {
    const sql = translateSql(
      "UPDATE inventory_lots SET allocated_cases = MAX(0, allocated_cases - ?), updated_at = ? WHERE batch_id = ?",
      3
    );

    assert.doesNotMatch(sql, /MAX\(0/);
    assert.match(sql, /GREATEST\(0, allocated_cases - \$1\)/);
    assert.match(sql, /updated_at = \$2/);
    assert.match(sql, /batch_id = \$3/);
  });
});
