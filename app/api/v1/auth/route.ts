import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError, parseJsonBody } from "@/server/core/http";
import {
  authenticateUser,
  completeMfaLogin,
  getDefaultAdminUser,
  getEffectiveAuthorization,
  getSessionFailureReason,
  getSessionUser,
  hydrateAuthorization,
  listRoleUsers,
  logoutSession,
  resetUserPassword,
  UserRole,
  normalizeRole
} from "@/server/security/auth";
import { signSessionToken } from "@/server/security/crypto";
import { getDb } from "@/server/db/connection";

export async function GET(req: NextRequest) {
  try {
    const sessionUser = getSessionUser(req);

    // A deleted/disabled account can still carry a cookie in another tab.
    // Never resolve a "default" user for such a request: doing so made the
    // UI silently appear as the seeded Super Admin after an admin deleted the
    // account. Unauthenticated means no identity, no permissions, no roles.
    if (!sessionUser) {
      return NextResponse.json(
        {
          authenticated: false,
          user: null,
          permissions: [],
          is_super_admin: false,
          scopes: null,
          available_roles: [],
          reason: getSessionFailureReason(req)
        },
        { status: 401 }
      );
    }

    const availableUsers = listRoleUsers();
    const effective =
      sessionUser.permissions ??
      getEffectiveAuthorization({
        id: sessionUser.id,
        role: sessionUser.role,
        roles: sessionUser.roles
      }).permissions;

    return NextResponse.json({
      authenticated: true,
      users_count: availableUsers.length,
      user: sessionUser,
      permissions: effective,
      is_super_admin: sessionUser.role === "super_admin" || effective.includes("*"),
      scopes: sessionUser.scopes ?? null,
      available_roles: availableUsers.map((u) => hydrateAuthorization(u))
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseJsonBody<{
      action?: "login" | "signup" | "register" | "logout" | "reset_password" | "switch_role" | "mfa_verify";
      name?: string;
      email?: string;
      password?: string;
      new_password?: string;
      role?: UserRole;
      warehouse?: string;
      store_id?: string | null;
      mfa_token?: string;
      code?: string;
    }>(req);

    const action = body.action ?? "login";
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "AscentraClient";

    if (action === "signup" || action === "register") {
      // Public self-service registration is retired. Visitors must use the
      // reviewed access-request flow (POST /api/v1/access-requests); accounts
      // are created only by administrators through /api/v1/admin/users or
      // via an approved access request (invitation accepted).
      return NextResponse.json(
        {
          error: {
            code: "PUBLIC_SIGNUP_RETIRED",
            message:
              "Public account creation is disabled. Submit an access request — an administrator will review it and send an invitation if approved.",
          },
        },
        { status: 410 }
      );
    }

    if (action === "logout") {
      const token = req.cookies.get("ascentra_session")?.value || req.cookies.get("ascentra_refresh")?.value;
      try {
        const user = getSessionUser(req) || getDefaultAdminUser();
        if (token) {
          logoutSession(token, user);
        }
      } catch {
        // Even if session revocation fails (e.g. the account was just
        // hard-deleted), the cookies below MUST still be cleared.
      }
      const res = NextResponse.json({ status: "signed_out", authenticated: false, user: null });
      res.cookies.delete("ascentra_session");
      res.cookies.delete("ascentra_refresh");
      return res;
    }

    if (action === "reset_password") {
      const actor = authorizeRequest(req);
      const result = resetUserPassword(
        body.email || actor.email,
        body.new_password || "",
        actor
      );
      return NextResponse.json(result);
    }

    if (action === "mfa_verify") {
      const { accessToken, refreshToken, user } = completeMfaLogin(
        body.mfa_token || "",
        body.code || "",
        ip,
        userAgent
      );

      const res = NextResponse.json({
        authenticated: true,
        token: accessToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        user,
        permissions: user.permissions ?? []
      });

      res.cookies.set("ascentra_session", accessToken, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12 // 12 hours
      });
      if (refreshToken) {
        res.cookies.set("ascentra_refresh", refreshToken, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: 60 * 60 * 24 * 7 // 7 days
        });
      }
      return res;
    }

    if (action === "switch_role") {
      // Development-only role preview. Disabled in production and restricted
      // to authenticated Super Admins to prevent privilege escalation.
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Role switching is disabled in production." } },
          { status: 403 }
        );
      }
      const switchingActor = authorizeRequest(req);
      if (switchingActor.role !== "super_admin") {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Only Super Admin may preview other roles." } },
          { status: 403 }
        );
      }
      const db = getDb();
      const targetEmail = body.email;
      const targetRole = body.role;
      const row = (targetEmail
        ? db
            .prepare(`SELECT id, email, name, role, store_id, warehouse FROM users WHERE lower(email) = lower(?) AND active = 1`)
            .get(targetEmail)
        : db
            .prepare(`SELECT id, email, name, role, store_id, warehouse FROM users WHERE role = ? AND active = 1 LIMIT 1`)
            .get(targetRole || "super_admin")) as
        | {
            id: string;
            email: string;
            name: string;
            role: string;
            store_id: string | null;
            warehouse: string | null;
          }
        | undefined;

      const selected = row
        ? hydrateAuthorization({
            ...row,
            role: normalizeRole(row.role),
            roles: [normalizeRole(row.role)]
          })
        : hydrateAuthorization(getDefaultAdminUser());

      const token = signSessionToken({
        sub: selected.id,
        email: selected.email,
        role: selected.role,
        name: selected.name,
        store_id: selected.store_id ?? null
      });

      const res = NextResponse.json({
        authenticated: true,
        token,
        user: selected,
        permissions: selected.permissions ?? []
      });
      res.cookies.set("ascentra_session", token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12
      });
      return res;
    }

    // Default: Login with email + password
    const loginResult = authenticateUser(
      body.email || "",
      body.password || "",
      ip,
      userAgent
    );

    if (loginResult.mfaRequired) {
      return NextResponse.json({
        authenticated: false,
        mfa_required: true,
        mfa_token: loginResult.mfaToken,
        user: loginResult.user
      });
    }

    const res = NextResponse.json({
      authenticated: true,
      token: loginResult.accessToken,
      access_token: loginResult.accessToken,
      refresh_token: loginResult.refreshToken,
      user: loginResult.user,
      permissions: loginResult.user.permissions ?? []
    });

    if (loginResult.accessToken) {
      res.cookies.set("ascentra_session", loginResult.accessToken, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12 // 12 hours
      });
    }

    if (loginResult.refreshToken) {
      res.cookies.set("ascentra_refresh", loginResult.refreshToken, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7 // 7 days
      });
    }

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
