import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/server/core/http";
import { requirePermission, listAuditEvents } from "@/server/security/auth";
import { getDb } from "@/server/db/connection";

export async function GET(req: NextRequest) {
  try {
    requirePermission(req, "audit.read");

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
    const actionFilter = url.searchParams.get("action");
    const entityTypeFilter = url.searchParams.get("entity_type");

    const db = getDb();
    let query = "SELECT id, actor_id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json, ip_address, created_at FROM audit_events";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (actionFilter) {
      conditions.push("action LIKE ?");
      params.push(`%${actionFilter}%`);
    }
    if (entityTypeFilter) {
      conditions.push("entity_type = ?");
      params.push(entityTypeFilter);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = db.prepare(query).all(...params) as Array<{
      id: string;
      actor_id: string;
      actor_email: string;
      actor_role: string;
      action: string;
      entity_type: string;
      entity_id: string;
      before_json: string | null;
      after_json: string | null;
      ip_address: string | null;
      created_at: string;
    }>;

    return NextResponse.json({
      total: rows.length,
      limit,
      offset,
      events: rows.map((r) => ({
        ...r,
        before: r.before_json ? JSON.parse(r.before_json) : null,
        after: r.after_json ? JSON.parse(r.after_json) : null
      }))
    });
  } catch (err) {
    return handleApiError(err);
  }
}
