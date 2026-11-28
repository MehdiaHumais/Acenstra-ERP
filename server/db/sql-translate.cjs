/**
 * SQLite -> PostgreSQL SQL translation.
 *
 * The application was written against Node's synchronous `node:sqlite` API.
 * Rather than rewriting ~1,200 call sites, the Postgres facade executes the
 * same SQL through this translator. It is intentionally conservative: it only
 * rewrites constructs that SQLite and PostgreSQL spell differently, and leaves
 * everything else untouched.
 */
"use strict";

/** Split a SQL batch into statements, respecting quoted strings. */
function splitStatements(sql) {
  const parts = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "\n") inLineComment = false;
    if (!inLineComment && c === "-" && sql[i + 1] === "-" && !inSingle && !inDouble) {
      inLineComment = true;
      cur += c;
      continue;
    }
    if (!inLineComment && c === "'" && !inDouble) inSingle = !inSingle;
    else if (!inLineComment && c === '"' && !inSingle) inDouble = !inDouble;
    if (c === ";" && !inSingle && !inDouble && !inLineComment) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** Replace `?` placeholders with `$1..$n` outside of quoted strings. */
function replacePlaceholders(sql) {
  let out = "";
  let inSingle = false;
  let inDouble = false;
  let idx = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      out += c;
      continue;
    }
    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      out += c;
      continue;
    }
    if (c === "?" && !inSingle && !inDouble) {
      out += "$" + ++idx;
      continue;
    }
    out += c;
  }
  return out;
}

const INTERVAL_RE = /'([+-]?)\s*(\d+)\s+(second|minute|hour|day|week|month|year)s?'/gi;

/** True when an offset is inside a single- or double-quoted SQL literal. */
function isQuoted(sql, index) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < index; i++) {
    if (sql[i] === "'" && !inDouble) inSingle = !inSingle;
    else if (sql[i] === '"' && !inSingle) inDouble = !inDouble;
  }
  return inSingle || inDouble;
}

/** Index of the `)` matching the `(` at `open`, or -1 when unbalanced. */
function findClosingParen(sql, open) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = open; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    if (inSingle || inDouble) continue;
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split a function argument list on top-level commas only. */
function splitArgs(text) {
  const args = [];
  let cur = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === "," && depth === 0) {
        args.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

/**
 * SQLite's scalar min()/max() accept two or more arguments; Postgres only has
 * the aggregate form. Rewrite multi-argument calls to LEAST/GREATEST while
 * preserving SQLite's NULL-propagation semantics. Single-argument aggregate
 * calls (e.g. MAX(created_at)) are left untouched.
 */
function translateScalarMinMax(sql) {
  let result = "";
  let cursor = 0;
  const re = /\b(MAX|MIN)\s*\(/gi;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const start = match.index;
    if (isQuoted(sql, start)) continue;
    const open = start + match[0].length - 1;
    const close = findClosingParen(sql, open);
    if (close === -1) continue;
    const rawArgs = splitArgs(sql.slice(open + 1, close));
    if (rawArgs.length <= 1) continue;

    const args = rawArgs.map((arg) => translateScalarMinMax(arg));
    const fn = match[1].toUpperCase() === "MAX" ? "GREATEST" : "LEAST";
    const nullChecks = args.map((arg) => `(${arg}) IS NULL`).join(" OR ");
    const replacement = `CASE WHEN ${nullChecks} THEN NULL ELSE ${fn}(${args.join(", ")}) END`;

    result += sql.slice(cursor, start) + replacement;
    cursor = close + 1;
    re.lastIndex = cursor;
  }
  result += sql.slice(cursor);
  return result;
}

function translateDateFunction(sql, fn, format) {
  const re = new RegExp("\\b" + fn + "\\s*\\(\\s*'now'\\s*(?:,\\s*((?:'[^']*'\\s*,?\\s*)+))?\\)", "gi");
  return sql.replace(re, (_m, args) => {
    let expr = "CURRENT_TIMESTAMP";
    if (args) {
      const modifiers = [];
      String(args).replace(INTERVAL_RE, (whole, sign, amount, unit) => {
        modifiers.push({ sign, amount, unit });
        return whole;
      });
      for (const mod of modifiers) {
        const sign = mod.sign === "-" ? "-" : "+";
        expr += ` ${sign} INTERVAL '${mod.amount} ${mod.unit}'`;
      }
    }
    return `to_char(${expr}, '${format}')`;
  });
}

/** Translate one statement. */
function translateStatement(input, paramCount) {
  let sql = input.trim();
  if (!sql) return "";

  // SQLite PRAGMAs: most are no-ops on Postgres, but deferred FK mode matters.
  if (/\bPRAGMA\s+defer_foreign_keys\s*=\s*ON\b/i.test(sql)) {
    sql = sql.replace(/\bPRAGMA\s+defer_foreign_keys\s*=\s*ON\b/gi, "SET CONSTRAINTS ALL DEFERRED");
  } else if (/^(PRAGMA|ANALYZE|VACUUM|REINDEX)\b/i.test(sql)) {
    return "";
  }

  const isInsertOrIgnore = /\bINSERT\s+OR\s+IGNORE\b/i.test(sql);

  sql = sql
    .replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT")
    .replace(/\bBEGIN\s+(IMMEDIATE|EXCLUSIVE|DEFERRED)\b/gi, "BEGIN")
    .replace(/\bsqlite_master\b/gi, "(SELECT tablename AS name, 'table' AS type FROM pg_catalog.pg_tables WHERE schemaname = 'public')")
    .replace(/\bBLOB\b/gi, "BYTEA")
    .replace(/\bGROUP_CONCAT\s*\(/gi, "STRING_AGG(");

  // Deferrable FKs let `SET CONSTRAINTS ALL DEFERRED` work in reset flows.
  sql = sql.replace(
    /(\bREFERENCES\s+[a-zA-Z0-9_]+\s*\([^)]*\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?)(?!\s+DEFERRABLE)/gi,
    "$1 DEFERRABLE"
  );

  // SQLite's date(column) normalizes a TEXT date to YYYY-MM-DD. Postgres's
  // native date(column) returns a date type, which cannot be compared with the
  // text produced by date('now') below. Keep both sides text-compatible.
  sql = sql.replace(
    /\bdate\s*\(\s*([a-zA-Z_][a-zA-Z0-9_$.]*)\s*\)/gi,
    (_m, column) => `to_char((${column})::date, 'YYYY-MM-DD')`
  );

  sql = translateDateFunction(sql, "datetime", "YYYY-MM-DD HH24:MI:SS");
  sql = translateDateFunction(sql, "date", "YYYY-MM-DD");

  // json_extract(column, '$.key') -> (column::jsonb->>'key')
  sql = sql.replace(
    /\bjson_extract\s*\(\s*([a-zA-Z0-9_.]+)\s*,\s*'\$\.([a-zA-Z0-9_]+)'\s*\)/gi,
    (_m, col, key) => `(${col}::jsonb->>'${key}')`
  );

  sql = sql.replace(/\bIFNULL\s*\(/gi, "COALESCE(");
  // SQLite's julianday(...) returns fractional days since the Julian epoch;
  // the app only uses differences, so epoch seconds / 86400 is equivalent.
  sql = sql.replace(/\bjulianday\s*\(\s*'now'\s*\)/gi, "(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) / 86400.0)");
  sql = sql.replace(
    /\bjulianday\s*\(\s*([a-zA-Z0-9_.]+)\s*\)/gi,
    (_m, column) => `(EXTRACT(EPOCH FROM (${column})::timestamp) / 86400.0)`
  );

  // SQLite LIKE is case-insensitive for ASCII by default; keep that behaviour.
  sql = sql.replace(/\bLIKE\s+\?/gi, "ILIKE ?");

  if (paramCount > 0) sql = replacePlaceholders(sql);

  // Must run after placeholder replacement: NULL checks repeat each argument,
  // so numbered parameters ($1) are reused safely while `?` would be duplicated.
  sql = translateScalarMinMax(sql);

  if (isInsertOrIgnore && !/\bON\s+CONFLICT\b/i.test(sql)) {
    sql = sql.replace(/;\s*$/, "") + " ON CONFLICT DO NOTHING";
  }

  return sql;
}

/**
 * Translate a SQL string. Returns the translated SQL for parameterized queries,
 * or a semicolon-joined batch for `exec`-style multi-statement SQL.
 */
function translateSql(sql, paramCount = 0, isBatch = false) {
  const statements = splitStatements(sql)
    .map((s) => translateStatement(s, paramCount))
    .filter(Boolean);
  if (isBatch) return statements.join(";\n");
  if (statements.length !== 1) {
    // A single query containing several statements is unusual; keep them all so
    // PostgreSQL can still execute them when no parameters are present.
    return statements.join(";\n");
  }
  return statements[0];
}

module.exports = { translateSql, splitStatements, replacePlaceholders };
