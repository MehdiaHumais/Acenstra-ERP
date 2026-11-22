import {
  ApiError
} from "@/server/core/http";
import { getDb, withTransaction } from "@/server/db/connection";
import {
  AuthenticatedUser,
  buildPermissionCatalog,
  ensureRbacConfig,
  getEffectiveAuthorization,
  normalizeRole,
  PermissionDescriptor,
  recordAuditEvent,
  RBAC_MODULES,
  SYSTEM_ROLE_DEFINITIONS,
  UserScopeSet
} from "@/server/security/auth";
import { hashPassword, revokeAllUserRefreshTokens } from "@/server/security/crypto";

export interface AccessUserSummary {
  id: string;
  email: string;
  name: string;
  role: string;
  roles: string[];
  role_names: string[];
  store_id: string | null;
  warehouse: string | null;
  active: boolean;
  mfa_enabled: boolean;
  must_change_password: boolean;
  locked: boolean;
  permissions: string[];
  scopes: UserScopeSet;
  created_at: string;
  last_login_at: string | null;
}

export interface AccessRoleSummary {
  code: string;
  name: string;
  description: string;
  role_type: "system" | "custom";
  base_role: string | null;
  is_system: boolean;
  protected: boolean;
  active: boolean;
  assigned_users: number;
  permissions: string[];
  created_at: string;
  updated_at: string;
}

function isSuperAdmin(actor: AuthenticatedUser): boolean {
  return actor.role === "super_admin" || Boolean(actor.permissions?.includes("*"));
}

function activeSuperAdminCount(): number {
  const db = getDb();
  return (
    db
      .prepare(
        `SELECT COUNT(DISTINCT u.id) as c
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         WHERE ur.role_code = 'super_admin' AND u.active = 1`
      )
      .get() as { c: number }
  ).c;
}

function targetRoles(userId: string): string[] {
  ensureRbacConfig();
  const db = getDb();
  return (
    db.prepare("SELECT role_code FROM user_roles WHERE user_id = ?").all(userId) as Array<{ role_code: string }>
  ).map((r) => r.role_code);
}

function targetIsSuperAdmin(userId: string): boolean {
  const db = getDb();
  const row = db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as { role: string } | undefined;
  if (row && normalizeRole(row.role) === "super_admin") return true;
  return targetRoles(userId).includes("super_admin");
}

function assertCanManageAccount(actor: AuthenticatedUser, userId: string): void {
  if (isSuperAdmin(actor)) return;
  if (targetIsSuperAdmin(userId)) {
    throw new ApiError(
      403,
      "PROTECTED_SUPER_ADMIN",
      "Only a Super Admin may modify a protected Super Admin account."
    );
  }
}

function assertRoleAssignable(actor: AuthenticatedUser, roleCode: string): void {
  // Every role code must exist in the persisted catalogue, including for a
  // Super Admin. Custom roles have to be created explicitly before assignment,
  // which prevents typo-driven phantom roles with unpredictable permissions.
  const db = getDb();
  const role = db.prepare("SELECT code, protected, active FROM roles WHERE code = ?").get(roleCode) as
    | { code: string; protected: number; active: number }
    | undefined;
  if (!role) {
    throw new ApiError(400, "ROLE_NOT_FOUND", `Role '${roleCode}' does not exist.`);
  }
  if (!role.active) {
    throw new ApiError(400, "ROLE_INACTIVE", `Role '${roleCode}' is deactivated and cannot be assigned.`);
  }
  if (isSuperAdmin(actor)) return;
  if (roleCode === "super_admin" || role.protected) {
    throw new ApiError(403, "PRIVILEGE_ESCALATION", "Only a Super Admin may assign this role.");
  }
}

function assertNoUnauthorizedGrant(actor: AuthenticatedUser, permissionCodes: string[]): void {
  if (isSuperAdmin(actor)) return;
  const actorPermissions = new Set(
    actor.permissions ??
      getEffectiveAuthorization({ id: actor.id, role: actor.role, roles: actor.roles }).permissions
  );
  for (const code of permissionCodes) {
    if (code === "*") {
      throw new ApiError(403, "PRIVILEGE_ESCALATION", "Only a Super Admin may grant full system access.");
    }
    if (!actorPermissions.has("*") && !actorPermissions.has(code)) {
      throw new ApiError(
        403,
        "PRIVILEGE_ESCALATION",
        `You cannot grant permission '${code}' because you do not hold it yourself.`
      );
    }
  }
}

function assertActiveSuperAdminRemains(excludeUserId: string): void {
  const db = getDb();
  const remaining = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT u.id) as c
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         WHERE ur.role_code = 'super_admin' AND u.active = 1 AND u.id != ?`
      )
      .get(excludeUserId) as { c: number }
  ).c;
  if (remaining === 0) {
    throw new ApiError(
      409,
      "LAST_ADMIN_PROTECTED",
      "This operation would remove the last active Super Admin. Assign another Super Admin first."
    );
  }
}

function normalizeScopes(input: Partial<Record<keyof UserScopeSet, string[]>> | undefined): UserScopeSet {
  const base: UserScopeSet = { company: [], warehouse: [], store: [], customer: [], supplier: [], delivery: [], task: [] };
  if (!input) return base;
  for (const key of Object.keys(base) as Array<keyof UserScopeSet>) {
    const values = input[key];
    if (Array.isArray(values)) {
      base[key] = Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean)));
    }
  }
  return base;
}

function replaceScopes(userId: string, scopes: UserScopeSet, actorEmail: string): void {
  const db = getDb();
  db.prepare("DELETE FROM user_scopes WHERE user_id = ?").run(userId);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO user_scopes (id, user_id, scope_type, scope_value, created_by) VALUES (?, ?, ?, ?, ?)"
  );
  let seq = Date.now();
  for (const key of Object.keys(scopes) as Array<keyof UserScopeSet>) {
    for (const value of scopes[key]) {
      seq += 1;
      insert.run(`SCP-${seq}`, userId, key, value, actorEmail);
    }
  }
}

function readScopes(userId: string): UserScopeSet {
  const db = getDb();
  const scopes: UserScopeSet = { company: [], warehouse: [], store: [], customer: [], supplier: [], delivery: [], task: [] };
  const rows = db
    .prepare("SELECT scope_type, scope_value FROM user_scopes WHERE user_id = ?")
    .all(userId) as Array<{ scope_type: string; scope_value: string }>;
  for (const row of rows) {
    const key = row.scope_type as keyof UserScopeSet;
    if (key in scopes) scopes[key].push(row.scope_value);
  }
  return scopes;
}

function roleNames(roleCodes: string[]): string[] {
  if (roleCodes.length === 0) return [];
  const db = getDb();
  const placeholders = roleCodes.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT code, name FROM roles WHERE code IN (${placeholders})`)
    .all(...roleCodes) as Array<{ code: string; name: string }>;
  const byCode = new Map(rows.map((r) => [r.code, r.name]));
  return roleCodes.map((code) => byCode.get(code) ?? code);
}

function summarizeUser(row: {
  id: string;
  email: string;
  name: string;
  role: string;
  store_id: string | null;
  warehouse: string | null;
  active: number;
  mfa_enabled: number;
  locked_until: string | null;
  created_at: string;
  must_change_password?: number;
}): AccessUserSummary {
  const db = getDb();
  const effective = getEffectiveAuthorization({ id: row.id, role: row.role });
  const roles = effective.roles;
  const lastLogin = db
    .prepare("SELECT MAX(created_at) as last_at FROM user_sessions WHERE user_id = ?")
    .get(row.id) as { last_at: string | null } | undefined;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: normalizeRole(row.role),
    roles,
    role_names: roleNames(roles),
    store_id: row.store_id,
    warehouse: row.warehouse,
    active: Boolean(row.active),
    mfa_enabled: Boolean(row.mfa_enabled),
    locked: Boolean(row.locked_until && new Date(row.locked_until).getTime() > Date.now()),
    must_change_password: Boolean(row.must_change_password),
    permissions: effective.permissions,
    scopes: effective.scopes,
    created_at: row.created_at,
    last_login_at: lastLogin?.last_at ?? null
  };
}

export function listAccessUsers(
  actor: AuthenticatedUser,
  options: { search?: string; role?: string; status?: string; limit?: number; offset?: number } = {}
): { total: number; limit: number; offset: number; users: AccessUserSummary[] } {
  ensureRbacConfig();
  const db = getDb();
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (options.search) {
    conditions.push("(lower(u.name) LIKE ? OR lower(u.email) LIKE ?)");
    const term = `%${options.search.toLowerCase()}%`;
    params.push(term, term);
  }
  if (options.role) {
    conditions.push("(u.role = ? OR EXISTS (SELECT 1 FROM user_roles ur2 WHERE ur2.user_id = u.id AND ur2.role_code = ?))");
    params.push(options.role, options.role);
  }
  if (options.status === "active") conditions.push("u.active = 1");
  if (options.status === "suspended") conditions.push("u.active = 0");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM users u ${where}`).get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.store_id, u.warehouse, u.active, u.mfa_enabled,
              u.locked_until, u.created_at, u.must_change_password
       FROM users u ${where}
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Array<{
    id: string;
    email: string;
    name: string;
    role: string;
    store_id: string | null;
    warehouse: string | null;
    active: number;
    mfa_enabled: number;
    locked_until: string | null;
    created_at: string;
    must_change_password?: number;
  }>;
  return { total, limit, offset, users: rows.map(summarizeUser) };
}

export function getAccessUser(actor: AuthenticatedUser, userId: string): AccessUserSummary {
  ensureRbacConfig();
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, email, name, role, store_id, warehouse, active, mfa_enabled, locked_until, created_at, must_change_password
       FROM users WHERE id = ?`
    )
    .get(userId) as
    | {
        id: string;
        email: string;
        name: string;
        role: string;
        store_id: string | null;
        warehouse: string | null;
        active: number;
        mfa_enabled: number;
        locked_until: string | null;
        created_at: string;
        must_change_password?: number;
      }
    | undefined;
  if (!row) throw new ApiError(404, "USER_NOT_FOUND", "User not found.");
  return summarizeUser(row);
}

export interface CreateUserInput {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
  roles?: string[];
  warehouse?: string;
  store_id?: string | null;
  scopes?: Partial<Record<keyof UserScopeSet, string[]>>;
  permissions?: Array<{ code: string; effect?: "grant" | "deny" }>;
}

export function createAccessUser(actor: AuthenticatedUser, input: CreateUserInput): AccessUserSummary {
  ensureRbacConfig();
  const db = getDb();
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  const password = input.password || "";
  if (!name) throw new ApiError(400, "VALIDATION_ERROR", "Full name is required.");
  if (!email || !email.includes("@")) throw new ApiError(400, "VALIDATION_ERROR", "A valid email address is required.");
  if (password.length < 8) throw new ApiError(400, "WEAK_PASSWORD", "Password must be at least 8 characters long.");

  const requestedRoles = (input.roles && input.roles.length ? input.roles : [input.role || "picker"]).map((r) =>
    normalizeRole(r)
  );
  const roleSet = Array.from(new Set(requestedRoles));
  for (const roleCode of roleSet) assertRoleAssignable(actor, roleCode);

  const warehouse = (input.warehouse || "Milan Cold Hub").trim();
  const storeId = input.store_id ?? null;
  const explicitPermissions = input.permissions ?? [];
  for (const p of explicitPermissions) assertNoUnauthorizedGrant(actor, [p.code]);

  const existing = db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email);
  if (existing) throw new ApiError(409, "EMAIL_EXISTS", "A user with this email already exists.");

  const id = `USR-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const passwordHash = hashPassword(password);
  const primaryRole = roleSet[0];

  withTransaction((tx) => {
    tx.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, store_id, warehouse, mfa_enabled, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`
    ).run(id, email, name, passwordHash, primaryRole, storeId, warehouse);
    const insertRole = tx.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_code, assigned_by) VALUES (?, ?, ?)");
    for (const roleCode of roleSet) insertRole.run(id, roleCode, actor.email);

    const scopes = normalizeScopes(input.scopes);
    if (scopes.warehouse.length === 0 && warehouse && warehouse !== "All") scopes.warehouse.push(warehouse);
    if (scopes.store.length === 0 && storeId) scopes.store.push(storeId);
    replaceScopes(id, scopes, actor.email);

    const insertPerm = tx.prepare(
      "INSERT OR REPLACE INTO user_permissions (user_id, permission_code, effect, granted_by) VALUES (?, ?, ?, ?)"
    );
    for (const p of explicitPermissions) insertPerm.run(id, p.code, p.effect === "deny" ? "deny" : "grant", actor.email);
  });

  recordAuditEvent({
    actor,
    action: "admin.user_created",
    entityType: "User",
    entityId: id,
    after: { email, name, roles: roleSet, warehouse, store_id: storeId, scopes: input.scopes ?? null }
  });

  return getAccessUser(actor, id);
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  active?: boolean;
  warehouse?: string;
  store_id?: string | null;
  roles?: string[];
  primary_role?: string;
  scopes?: Partial<Record<keyof UserScopeSet, string[]>>;
  permissions?: Array<{ code: string; effect?: "grant" | "deny" }>;
}

export function updateAccessUser(actor: AuthenticatedUser, userId: string, input: UpdateUserInput): AccessUserSummary {
  ensureRbacConfig();
  const db = getDb();
  const before = getAccessUser(actor, userId);
  assertCanManageAccount(actor, userId);

  const nextActive = input.active === undefined ? (before.active ? 1 : 0) : input.active ? 1 : 0;
  if (nextActive === 0 && userId === actor.id) {
    throw new ApiError(409, "SELF_LOCKOUT_PROTECTED", "You cannot suspend your own account.");
  }

  let nextRoles = before.roles;
  if (input.roles && input.roles.length > 0) {
    nextRoles = Array.from(new Set(input.roles.map((r) => normalizeRole(r))));
    for (const roleCode of nextRoles) assertRoleAssignable(actor, roleCode);
    const primary = normalizeRole(input.primary_role || nextRoles[0]);
    if (!nextRoles.includes(primary)) nextRoles.unshift(primary);
  }
  const nextPrimary = normalizeRole(input.primary_role || nextRoles[0] || before.role);

  const losesSuperAdmin = before.roles.includes("super_admin") && !nextRoles.includes("super_admin");
  if ((losesSuperAdmin || nextActive === 0) && before.roles.includes("super_admin")) {
    assertActiveSuperAdminRemains(userId);
  }

  const explicitPermissions = input.permissions ?? [];
  for (const p of explicitPermissions) assertNoUnauthorizedGrant(actor, [p.code]);
  const nextScopes = input.scopes ? normalizeScopes(input.scopes) : before.scopes;

  withTransaction((tx) => {
    const fields: string[] = ["role = ?", "active = ?"];
    const values: Array<string | number | null> = [nextPrimary, nextActive];
    if (input.name !== undefined) {
      fields.push("name = ?");
      values.push(input.name.trim());
    }
    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      const duplicate = tx.prepare("SELECT id FROM users WHERE lower(email) = ? AND id != ?").get(email, userId);
      if (duplicate) throw new ApiError(409, "EMAIL_EXISTS", "Another account already uses this email address.");
      fields.push("email = ?");
      values.push(email);
    }
    if (input.warehouse !== undefined) {
      fields.push("warehouse = ?");
      values.push(input.warehouse);
    }
    if (input.store_id !== undefined) {
      fields.push("store_id = ?");
      values.push(input.store_id);
    }
    if (input.password) {
      if (input.password.length < 8) throw new ApiError(400, "WEAK_PASSWORD", "Password must be at least 8 characters long.");
      // Admin-set passwords are temporary — the user must choose their own on next sign-in.
      fields.push("password_hash = ?", "failed_attempts = 0", "locked_until = NULL", "must_change_password = 1");
      values.push(hashPassword(input.password));
    }
    values.push(userId);
    tx.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);

    if (input.roles && input.roles.length > 0) {
      tx.prepare("DELETE FROM user_roles WHERE user_id = ?").run(userId);
      const insertRole = tx.prepare(
        "INSERT OR IGNORE INTO user_roles (user_id, role_code, assigned_by) VALUES (?, ?, ?)"
      );
      for (const roleCode of nextRoles) insertRole.run(userId, roleCode, actor.email);
    }

    if (input.scopes) replaceScopes(userId, nextScopes, actor.email);

    if (input.permissions) {
      tx.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(userId);
      const insertPerm = tx.prepare(
        "INSERT OR REPLACE INTO user_permissions (user_id, permission_code, effect, granted_by) VALUES (?, ?, ?, ?)"
      );
      for (const p of input.permissions) insertPerm.run(userId, p.code, p.effect === "deny" ? "deny" : "grant", actor.email);
    }
  });

  const rolesChanged = JSON.stringify(before.roles) !== JSON.stringify(nextRoles);
  if (rolesChanged || nextActive === 0 || input.password) {
    revokeAllUserRefreshTokens(userId);
  }

  recordAuditEvent({
    actor,
    action:
      nextActive === 0
        ? "admin.user_suspended"
        : before.active === false && nextActive === 1
          ? "admin.user_reactivated"
          : "admin.user_updated",
    entityType: "User",
    entityId: userId,
    before: {
      email: before.email,
      name: before.name,
      roles: before.roles,
      active: before.active,
      warehouse: before.warehouse,
      store_id: before.store_id,
      scopes: before.scopes
    },
    after: {
      email: input.email ?? before.email,
      name: input.name ?? before.name,
      roles: nextRoles,
      active: Boolean(nextActive),
      warehouse: input.warehouse ?? before.warehouse,
      store_id: input.store_id ?? before.store_id,
      scopes: nextScopes
    }
  });

  return getAccessUser(actor, userId);
}

/**
 * Permanently deletes an account. The users row and every dependent record
 * (refresh tokens, sessions, barcode/QR credentials, roles, permissions,
 * scopes) are removed inside one transaction. Audit events keep the full
 * before/after snapshot (actor email, entity id), so the action stays
 * traceable without retaining personal data. Deleting an account frees its
 * email address for immediate re-use — no EMAIL_EXISTS errors afterwards.
 * Use the suspend (pause) action when the person may return.
 */
export function deleteAccessUser(actor: AuthenticatedUser, userId: string): { deleted: boolean; retained: boolean } {
  ensureRbacConfig();
  const before = getAccessUser(actor, userId);
  assertCanManageAccount(actor, userId);
  if (userId === actor.id) {
    throw new ApiError(409, "SELF_LOCKOUT_PROTECTED", "You cannot delete your own account.");
  }
  if (before.roles.includes("super_admin")) {
    assertActiveSuperAdminRemains(userId);
  }
  const db = getDb();
  withTransaction((tx) => {
    // Keep a tombstone first: the email stays reusable, but a later login
    // attempt (or a still-open session) can be told the account was deleted.
    tx.prepare(
      "INSERT INTO deleted_accounts (id, email, name, roles_json, deleted_by) VALUES (?, ?, ?, ?, ?)"
    ).run(
      `DEL-${Date.now()}-${Math.floor(Math.random() * 90000 + 10000)}`,
      before.email,
      before.name,
      JSON.stringify(before.roles ?? []),
      actor.email
    );
    tx.prepare("DELETE FROM user_roles WHERE user_id = ?").run(userId);
    tx.prepare("DELETE FROM user_permissions WHERE user_id = ?").run(userId);
    tx.prepare("DELETE FROM user_scopes WHERE user_id = ?").run(userId);
    // Explicit even though the FKs cascade — keeps the intent obvious and
    // protects older databases created before the cascade existed.
    tx.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(userId);
    tx.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(userId);
    tx.prepare("DELETE FROM user_credentials WHERE user_id = ?").run(userId);
    tx.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
  recordAuditEvent({
    actor,
    action: "admin.user_deleted",
    entityType: "User",
    entityId: userId,
    before: {
      email: before.email,
      name: before.name,
      roles: before.roles,
      active: before.active,
      warehouse: before.warehouse,
      store_id: before.store_id
    },
    after: { deleted: true }
  });
  return { deleted: true, retained: false };
}

export function listAccessRoles(actor: AuthenticatedUser): AccessRoleSummary[] {
  ensureRbacConfig();
  const db = getDb();
  const roles = db
    .prepare(
      "SELECT code, name, description, role_type, base_role, is_system, protected, active, created_at, updated_at FROM roles ORDER BY is_system DESC, name ASC"
    )
    .all() as Array<{
    code: string;
    name: string;
    description: string;
    role_type: string;
    base_role: string | null;
    is_system: number;
    protected: number;
    active: number;
    created_at: string;
    updated_at: string;
  }>;
  return roles.map((role) => {
    const permissions = (
      db.prepare("SELECT permission_code FROM role_permissions WHERE role_code = ?").all(role.code) as Array<{
        permission_code: string;
      }>
    ).map((r) => r.permission_code);
    const assigned = (
      db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM user_roles WHERE role_code = ?").get(role.code) as {
        c: number;
      }
    ).c;
    return {
      code: role.code,
      name: role.name,
      description: role.description,
      role_type: role.role_type === "system" ? "system" : "custom",
      base_role: role.base_role,
      is_system: Boolean(role.is_system),
      protected: Boolean(role.protected),
      active: Boolean(role.active),
      assigned_users: assigned,
      permissions,
      created_at: role.created_at,
      updated_at: role.updated_at
    };
  });
}

function slugifyRoleCode(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function validPermissionCodes(codes: string[]): string[] {
  const db = getDb();
  const catalog = new Set(buildPermissionCatalog().map((p) => p.code));
  for (const code of codes) {
    if (!catalog.has(code) && code !== "*") {
      throw new ApiError(400, "UNKNOWN_PERMISSION", `Permission '${code}' is not part of the permission catalogue.`);
    }
  }
  return Array.from(new Set(codes));
}

export function createAccessRole(
  actor: AuthenticatedUser,
  input: { code?: string; name?: string; description?: string; base_role?: string; permissions?: string[] }
): AccessRoleSummary {
  ensureRbacConfig();
  const db = getDb();
  const name = (input.name || "").trim();
  if (!name) throw new ApiError(400, "VALIDATION_ERROR", "Role name is required.");
  const code = slugifyRoleCode(input.code || name);
  if (!code) throw new ApiError(400, "VALIDATION_ERROR", "Role code is invalid.");

  const existing = db.prepare("SELECT code FROM roles WHERE code = ?").get(code);
  if (existing) throw new ApiError(409, "ROLE_EXISTS", `Role code '${code}' already exists.`);

  let permissions = input.permissions ? validPermissionCodes(input.permissions) : [];
  if (input.base_role && permissions.length === 0) {
    permissions = (
      db.prepare("SELECT permission_code FROM role_permissions WHERE role_code = ?").all(input.base_role) as Array<{
        permission_code: string;
      }>
    ).map((r) => r.permission_code);
  }
  assertNoUnauthorizedGrant(actor, permissions);

  withTransaction((tx) => {
    tx.prepare(
      `INSERT INTO roles (code, name, description, role_type, base_role, is_system, protected, active, created_by)
       VALUES (?, ?, ?, 'custom', ?, 0, 0, 1, ?)`
    ).run(code, name, (input.description || "").trim(), input.base_role ?? null, actor.email);
    const insertPerm = tx.prepare("INSERT OR IGNORE INTO role_permissions (role_code, permission_code) VALUES (?, ?)");
    for (const permission of permissions) insertPerm.run(code, permission);
  });

  recordAuditEvent({
    actor,
    action: "admin.role_created",
    entityType: "Role",
    entityId: code,
    after: { name, description: input.description ?? "", base_role: input.base_role ?? null, permissions }
  });

  return listAccessRoles(actor).find((r) => r.code === code)!;
}

export function updateAccessRole(
  actor: AuthenticatedUser,
  roleCode: string,
  input: { name?: string; description?: string; permissions?: string[]; active?: boolean }
): AccessRoleSummary {
  ensureRbacConfig();
  const db = getDb();
  const role = db
    .prepare("SELECT code, name, description, is_system, protected, active FROM roles WHERE code = ?")
    .get(roleCode) as
    | { code: string; name: string; description: string; is_system: number; protected: number; active: number }
    | undefined;
  if (!role) throw new ApiError(404, "ROLE_NOT_FOUND", "Role not found.");

  if (role.is_system && !isSuperAdmin(actor)) {
    throw new ApiError(403, "PROTECTED_ROLE", "Only a Super Admin may modify a predefined system role.");
  }
  if (roleCode === "super_admin" && input.active === false) {
    throw new ApiError(409, "PROTECTED_ROLE", "The Super Admin role cannot be deactivated.");
  }
  if (input.active === false && role.is_system) {
    throw new ApiError(409, "PROTECTED_ROLE", "Predefined system roles cannot be deactivated.");
  }
  if (input.active === false) {
    const assigned = (
      db.prepare("SELECT COUNT(*) as c FROM user_roles WHERE role_code = ?").get(roleCode) as { c: number }
    ).c;
    if (assigned > 0) {
      throw new ApiError(
        409,
        "ROLE_IN_USE",
        `Role '${roleCode}' is assigned to ${assigned} user(s). Reassign them before deactivating the role.`
      );
    }
  }

  const permissions = input.permissions ? validPermissionCodes(input.permissions) : null;
  if (permissions) assertNoUnauthorizedGrant(actor, permissions);

  withTransaction((tx) => {
    if (input.name !== undefined || input.description !== undefined || input.active !== undefined) {
      tx.prepare(
        `UPDATE roles SET name = ?, description = ?, active = ?, updated_at = datetime('now') WHERE code = ?`
      ).run(
        input.name !== undefined ? input.name.trim() : role.name,
        input.description !== undefined ? input.description.trim() : role.description,
        input.active === undefined ? role.active : input.active ? 1 : 0,
        roleCode
      );
    }
    if (permissions) {
      tx.prepare("DELETE FROM role_permissions WHERE role_code = ?").run(roleCode);
      const insertPerm = tx.prepare("INSERT OR IGNORE INTO role_permissions (role_code, permission_code) VALUES (?, ?)");
      for (const permission of permissions) insertPerm.run(roleCode, permission);
    }
  });

  // Role changes must invalidate active sessions for assigned users.
  const assignedUsers = db.prepare("SELECT user_id FROM user_roles WHERE role_code = ?").all(roleCode) as Array<{
    user_id: string;
  }>;
  for (const assigned of assignedUsers) revokeAllUserRefreshTokens(assigned.user_id);

  recordAuditEvent({
    actor,
    action: "admin.role_updated",
    entityType: "Role",
    entityId: roleCode,
    before: { name: role.name, description: role.description, active: Boolean(role.active) },
    after: {
      name: input.name ?? role.name,
      description: input.description ?? role.description,
      active: input.active ?? Boolean(role.active),
      permissions: permissions ?? undefined
    }
  });

  return listAccessRoles(actor).find((r) => r.code === roleCode)!;
}

export function duplicateAccessRole(
  actor: AuthenticatedUser,
  roleCode: string,
  input: { name?: string; code?: string }
): AccessRoleSummary {
  ensureRbacConfig();
  const db = getDb();
  const source = listAccessRoles(actor).find((r) => r.code === roleCode);
  if (!source) throw new ApiError(404, "ROLE_NOT_FOUND", "Source role not found.");
  return createAccessRole(actor, {
    code: input.code,
    name: input.name || `${source.name} (Copy)`,
    description: source.description,
    base_role: source.code,
    permissions: source.permissions
  });
}

export function listPermissionMatrix(actor: AuthenticatedUser): {
  modules: Array<{ code: string; name: string; description: string; permissions: PermissionDescriptor[] }>;
  permissions: PermissionDescriptor[];
} {
  ensureRbacConfig();
  const catalog = buildPermissionCatalog();
  return {
    modules: RBAC_MODULES.map((m) => ({
      code: m.code,
      name: m.name,
      description: m.description,
      permissions: catalog.filter((p) => p.module === m.name && p.code !== m.code)
    })),
    permissions: catalog
  };
}

export function listApprovalThresholds(_actor: AuthenticatedUser): Array<{
  action_code: string;
  label: string;
  amount_cents: number | null;
  requires_permission: string;
  maker_checker: boolean;
  active: boolean;
  updated_by: string | null;
  updated_at: string;
}> {
  return getApprovalThresholdList();
}

export function getApprovalThresholdList(): Array<{
  action_code: string;
  label: string;
  amount_cents: number | null;
  requires_permission: string;
  maker_checker: boolean;
  active: boolean;
  updated_by: string | null;
  updated_at: string;
}> {
  ensureRbacConfig();
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT action_code, label, amount_cents, requires_permission, maker_checker, active, updated_by, updated_at FROM approval_thresholds ORDER BY label ASC"
    )
    .all() as Array<{
    action_code: string;
    label: string;
    amount_cents: number | null;
    requires_permission: string;
    maker_checker: number;
    active: number;
    updated_by: string | null;
    updated_at: string;
  }>;
  return rows.map((row) => ({
    action_code: row.action_code,
    label: row.label,
    amount_cents: row.amount_cents,
    requires_permission: row.requires_permission,
    maker_checker: Boolean(row.maker_checker),
    active: Boolean(row.active),
    updated_by: row.updated_by,
    updated_at: row.updated_at
  }));
}

export function updateApprovalThreshold(
  actor: AuthenticatedUser,
  actionCode: string,
  input: {
    label?: string;
    amount_cents?: number | null;
    requires_permission?: string;
    maker_checker?: boolean;
    active?: boolean;
  }
): ReturnType<typeof getApprovalThresholdList>[number] {
  ensureRbacConfig();
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM approval_thresholds WHERE action_code = ?")
    .get(actionCode) as
    | {
        action_code: string;
        label: string;
        amount_cents: number | null;
        requires_permission: string;
        maker_checker: number;
        active: number;
      }
    | undefined;
  if (!existing) throw new ApiError(404, "APPROVAL_NOT_FOUND", "Approval threshold not found.");
  if (input.requires_permission) validPermissionCodes([input.requires_permission]);

  db.prepare(
    `UPDATE approval_thresholds
     SET label = ?, amount_cents = ?, requires_permission = ?, maker_checker = ?, active = ?, updated_by = ?, updated_at = datetime('now')
     WHERE action_code = ?`
  ).run(
    input.label ?? existing.label,
    input.amount_cents !== undefined ? input.amount_cents : existing.amount_cents,
    input.requires_permission ?? existing.requires_permission,
    input.maker_checker === undefined ? existing.maker_checker : input.maker_checker ? 1 : 0,
    input.active === undefined ? existing.active : input.active ? 1 : 0,
    actor.email,
    actionCode
  );

  recordAuditEvent({
    actor,
    action: "admin.approval_threshold_updated",
    entityType: "ApprovalThreshold",
    entityId: actionCode,
    before: existing,
    after: input
  });

  return getApprovalThresholdList().find((t) => t.action_code === actionCode)!;
}

export function listSecurityEvents(
  actor: AuthenticatedUser,
  options: { limit?: number; offset?: number; action?: string; actor?: string } = {}
): { total: number; events: Array<Record<string, unknown>> } {
  const db = getDb();
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 200);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const conditions: string[] = [
    "(action LIKE 'admin.%' OR action LIKE 'auth.%' OR action LIKE 'security.%' OR action LIKE 'approval.%')"
  ];
  const params: Array<string | number> = [];
  if (options.action) {
    conditions.push("action LIKE ?");
    params.push(`%${options.action}%`);
  }
  if (options.actor) {
    conditions.push("(lower(actor_email) LIKE ? OR actor_id = ?)");
    params.push(`%${options.actor.toLowerCase()}%`, options.actor);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const total = (db.prepare(`SELECT COUNT(*) as c FROM audit_events ${where}`).get(...params) as { c: number }).c;
  const events = db
    .prepare(
      `SELECT id, actor_id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json, ip_address, created_at
       FROM audit_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;
  return { total, events };
}

export function getRoleDefinition(code: string) {
  ensureRbacConfig();
  return SYSTEM_ROLE_DEFINITIONS.find((r) => r.code === code) ?? null;
}

export function listRoleCatalog() {
  ensureRbacConfig();
  return listAccessRoles({ id: "system", email: "system", name: "system", role: "super_admin" });
}
