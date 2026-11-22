export type SqlPrimitive = string | number | bigint | Uint8Array | null;

export interface PreparedStatementSync {
  run(...params: SqlPrimitive[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get<T = Record<string, unknown>>(...params: SqlPrimitive[]): T | undefined;
  all<T = Record<string, unknown>>(...params: SqlPrimitive[]): T[];
}

export interface SqliteDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): PreparedStatementSync;
  close(): void;
}

export function openSqliteDatabase(filename: string): SqliteDatabaseSync {
  const proc = process as unknown as {
    getBuiltinModule?: (id: string) => { DatabaseSync: new (path: string) => SqliteDatabaseSync } | undefined;
  };
  const builtin =
    typeof proc.getBuiltinModule === "function"
      ? proc.getBuiltinModule("node:sqlite") ?? proc.getBuiltinModule("sqlite")
      : undefined;

  if (!builtin?.DatabaseSync) {
    throw new Error("Node.js built-in node:sqlite module is required (Node 22.5+ / Node 24+).");
  }

  return new builtin.DatabaseSync(filename);
}
