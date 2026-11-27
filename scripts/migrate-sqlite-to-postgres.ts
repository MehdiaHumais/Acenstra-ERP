/**
 * Copy the current local SQLite database into Supabase/PostgreSQL.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-sqlite-to-postgres.ts
 *
 * Optional:
 *   MIGRATE_DROP_EXISTING=true   Drop all public tables first (fresh re-import).
 *   SQLITE_DB_PATH=...           Source SQLite file (default ./data/ascentra-erp.sqlite)
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { Client } from "pg";

const require = createRequire(import.meta.url);
const { translateSql } = require("../server/db/sql-translate.cjs") as {
  translateSql: (sql: string, paramCount?: number, isBatch?: boolean) => string;
};

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
}

interface TableInfo {
  name: string;
  columns: string[];
  defs: ColumnInfo[];
}

function loadSchemaSql(): string {
  const source = fs.readFileSync(path.join(process.cwd(), "server", "db", "connection.ts"), "utf8");
  const match = /const\s+SCHEMA_SQL\s*=\s*`([\s\S]*?)`\s*;/.exec(source);
  if (!match) throw new Error("Could not locate SCHEMA_SQL in server/db/connection.ts");
  return match[1];
}

function quoteIdent(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * SQLite permits forward REFERENCES (a table may point at one created later).
 * PostgreSQL does not, so create tables first and add foreign keys afterwards.
 */
function buildForeignKeyStatements(schemaSql: string): string[] {
  const statements: string[] = [];
  const tableRegex = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(schemaSql)) !== null) {
    const table = tableMatch[1];
    const lines = tableMatch[2].split("\n");
    for (const rawLine of lines) {
      const line = rawLine.replace(/--.*$/, "").trim().replace(/,$/, "").trim();
      const fk = /^([a-zA-Z0-9_]+)\s+[a-zA-Z0-9_]+\b.*?\bREFERENCES\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)(.*)$/i.exec(line);
      if (!fk) continue;
      const [, column, refTable, refColumn, tail] = fk;
      const name = `fk_${table}_${column}`.slice(0, 63);
      const onDelete = /ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i.exec(tail)?.[0] || "";
      const onUpdate = /ON\s+UPDATE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i.exec(tail)?.[0] || "";
      statements.push(
        `ALTER TABLE ${quoteIdent(table)} ADD CONSTRAINT ${quoteIdent(name)} ` +
          `FOREIGN KEY (${quoteIdent(column)}) REFERENCES ${quoteIdent(refTable)} (${quoteIdent(refColumn.trim())})` +
          `${onDelete ? " " + onDelete : ""}${onUpdate ? " " + onUpdate : ""} DEFERRABLE;`
      );
    }
  }
  return statements;
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "bigint") return Number(value);
  return value;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");

  const sqlitePath = path.resolve(
    process.cwd(),
    process.env.SQLITE_DB_PATH?.trim() || "./data/ascentra-erp.sqlite"
  );
  if (!fs.existsSync(sqlitePath)) throw new Error(`SQLite file not found: ${sqlitePath}`);

  // Node 24 supports readOnly; the pinned @types/node 22 definition omits it.
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true } as ConstructorParameters<typeof DatabaseSync>[1]);
  const pg = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    statement_timeout: 120_000,
    query_timeout: 120_000,
  });
  await pg.connect();

  try {
    console.log("SOURCE:", sqlitePath);
    console.log("TARGET:", new URL(connectionString).host);

    if (process.env.MIGRATE_DROP_EXISTING === "true") {
      console.log("Dropping existing public tables...");
      await pg.query(`
        DO $$ DECLARE r RECORD;
        BEGIN
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
          END LOOP;
        END $$;
      `);
    }

    console.log("Creating schema...");
    const schemaSource = loadSchemaSql();
    const noForwardFks = schemaSource.replace(/\s+REFERENCES\s+[a-zA-Z0-9_]+\s*\([^)]*\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+(?:CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?/gi, "");
    await pg.query(translateSql(noForwardFks, 0, true));
    console.log("Tables created.");

    const sqliteTables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;

    const tables: TableInfo[] = sqliteTables.map(({ name }) => {
      const defs = sqlite.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as ColumnInfo[];
      return { name, columns: defs.map((c) => c.name), defs };
    });
    console.log(`Found ${tables.length} SQLite tables.`);

    // The running SQLite app adds columns via ALTER TABLE at startup; those
    // columns are not all present in SCHEMA_SQL. Mirror them into Postgres.
    const notNullColumns = new Map<string, Map<string, string>>();
    let addedColumns = 0;
    for (const table of tables) {
      const pgColumns = (
        await pg.query(
          "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
          [table.name]
        )
      ).rows as Array<{ column_name: string; data_type: string; is_nullable: string }>;
      const existing = new Set(pgColumns.map((r) => r.column_name.toLowerCase()));
      notNullColumns.set(
        table.name,
        new Map(
          pgColumns
            .filter((r) => r.is_nullable === "NO")
            .map((r) => [r.column_name, r.data_type])
        )
      );
      for (const col of table.defs) {
        if (existing.has(col.name.toLowerCase())) continue;
        const type = /BLOB/i.test(col.type)
          ? "BYTEA"
          : /INT/i.test(col.type)
            ? "INTEGER"
            : /REAL|FLOT|DOUB/i.test(col.type)
              ? "DOUBLE PRECISION"
              : "TEXT";
        let defaultClause = "";
        if (col.dflt_value !== null && col.dflt_value !== undefined) {
          const raw = String(col.dflt_value);
          if (/^-?\d+(\.\d+)?$/.test(raw)) defaultClause = ` DEFAULT ${raw}`;
          else if (/^'.*'$/.test(raw)) defaultClause = ` DEFAULT ${raw}`;
          else if (/^NULL$/i.test(raw)) defaultClause = "";
        } else if (col.notnull) {
          defaultClause = /INT|REAL|FLOT|DOUB|NUM/i.test(type) ? " DEFAULT 0" : " DEFAULT ''";
        }
        try {
          await pg.query(
            `ALTER TABLE ${quoteIdent(table.name)} ADD COLUMN ${quoteIdent(col.name)} ${type}${defaultClause}`
          );
          addedColumns++;
        } catch (err) {
          console.log(`COLUMN SKIP ${table.name}.${col.name}:`, err instanceof Error ? err.message.slice(0, 100) : "");
        }
      }
    }
    console.log(`Added ${addedColumns} runtime columns.`);

    let totalCopied = 0;
    const pending = [...tables];
    const failed: Array<{ table: string; error: string }> = [];

    for (let pass = 1; pass <= 5 && pending.length > 0; pass++) {
      const stillPending: TableInfo[] = [];
      let passCopied = 0;

      for (const table of pending) {
        const rows = sqlite.prepare(`SELECT * FROM ${quoteIdent(table.name)}`).all() as Array<Record<string, unknown>>;
        if (rows.length === 0) continue;

        const cols = table.columns.map(quoteIdent).join(", ");
        const batchSize = 100;
        try {
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const placeholders = batch
              .map((row) => "(" + table.columns.map(() => "?").join(", ") + ")")
              .join(", ");
            const pgNotNull = notNullColumns.get(table.name) || new Map<string, string>();
            const values = batch.flatMap((row) =>
              table.columns.map((c) => {
                const value = normalizeValue(row[c]);
                if (value !== null || !pgNotNull.has(c)) return value;
                const dataType = pgNotNull.get(c) || "";
                return /int|numeric|real|double|bigint/i.test(dataType) ? 0 : "";
              })
            );
            const sql = translateSql(
              `INSERT INTO ${quoteIdent(table.name)} (${cols}) VALUES ${placeholders}`,
              values.length
            );
            await pg.query(sql, values);
            passCopied += batch.length;
          }
          totalCopied += rows.length;
        } catch (err) {
          if (pass === 5) {
            failed.push({ table: table.name, error: err instanceof Error ? err.message.slice(0, 220) : String(err) });
          } else {
            stillPending.push(table);
          }
        }
      }

      console.log(`Pass ${pass}: copied ${passCopied} rows across ${pending.length - stillPending.length} tables.`);
      pending.length = 0;
      pending.push(...stillPending);
    }

    // Add foreign keys only after all rows exist, so circular references and
    // table-creation order cannot block the import.
    let fkCount = 0;
    let fkSkipped = 0;
    for (const fk of buildForeignKeyStatements(schemaSource)) {
      try {
        await pg.query(fk);
        fkCount++;
      } catch (err) {
        fkSkipped++;
        console.log("FK SKIP:", fk.slice(0, 90), err instanceof Error ? err.message.slice(0, 90) : "");
      }
    }
    console.log(`Foreign keys added: ${fkCount} (skipped ${fkSkipped}).`);

    // Verify row counts for the most important tables.
    const check = ["users", "products", "orders", "deleted_accounts", "inventory_lots"];
    for (const table of check) {
      try {
        const s = (sqlite.prepare(`SELECT COUNT(*) n FROM ${quoteIdent(table)}`).get() as { n: number }).n;
        const p = (await pg.query(`SELECT COUNT(*)::int n FROM ${quoteIdent(table)}`)).rows[0].n as number;
        console.log(`COUNT ${table.padEnd(20)} sqlite=${s} postgres=${p} ${s === p ? "OK" : "MISMATCH"}`);
      } catch {
        // table may not exist in this dataset
      }
    }

    console.log(`TOTAL ROWS COPIED: ${totalCopied}`);
    if (failed.length > 0) {
      console.log("TABLES WITH UNRESOLVED ERRORS:");
      for (const f of failed) console.log(`  ${f.table}: ${f.error}`);
    } else {
      console.log("MIGRATION COMPLETE: all tables copied.");
    }
  } finally {
    await pg.end().catch(() => {});
    sqlite.close();
  }
}

main().catch((err) => {
  console.error("MIGRATION FAILED:", err);
  process.exit(1);
});
