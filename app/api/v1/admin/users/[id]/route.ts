import { NextRequest, NextResponse } from "next/server";
import { handleApiError, parseJsonBody } from "@/server/core/http";
import { requirePermission } from "@/server/security/auth";
import {
  deleteAccessUser,
  getAccessUser,
  updateAccessUser,
  UpdateUserInput
} from "@/server/services/access-control.service";
import {
  sendMail,
  smtpConfigured,
  buildAccessChangedEmail,
  type AccessChangeEntry
} from "@/server/services/mail.service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = requirePermission(req, "users.read");
    return NextResponse.json(getAccessUser(actor, params.id));
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = requirePermission(req, "users.manage");
    const body = await parseJsonBody<UpdateUserInput>(req);
    const loginUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3001").replace(/\/+$/, "")}/login`;

    const before = getAccessUser(actor, params.id);
    const after = updateAccessUser(actor, params.id, body);

    // Notify the user when something access-relevant changed. Best-effort —
    // never fail the response because email delivery failed.
    try {
      const changes: AccessChangeEntry[] = [];
      if (JSON.stringify([...(before.roles ?? [])].sort()) !== JSON.stringify([...(after.roles ?? [])].sort())) {
        changes.push({ label: "Roles", before: (before.roles ?? []).join(", "), after: (after.roles ?? []).join(", ") });
      }
      if (before.role !== after.role) changes.push({ label: "Primary role", before: before.role, after: after.role });
      if (Boolean(before.active) !== Boolean(after.active)) {
        changes.push({ label: "Account status", before: before.active ? "Active" : "Deactivated", after: after.active ? "Active" : "Deactivated" });
      }
      if ((before.warehouse ?? null) !== (after.warehouse ?? null)) {
        changes.push({ label: "Warehouse", before: before.warehouse ?? "—", after: after.warehouse ?? "—" });
      }
      if ((before.store_id ?? null) !== (after.store_id ?? null)) {
        changes.push({ label: "Store / customer ID", before: before.store_id ?? "—", after: after.store_id ?? "—" });
      }
      if (body.password) changes.push({ label: "Password", before: "••••••••", after: "Reset by administrator" });
      if (body.permissions && body.permissions.length > 0) changes.push({ label: "Custom permissions", before: "Custom", after: `${body.permissions.length} grant(s)/deny(ies) updated` });
      if (body.scopes) changes.push({ label: "Data scopes", before: "Scopes updated", after: "Scopes updated" });

      if (changes.length > 0 && smtpConfigured()) {
        await sendMail(
          buildAccessChangedEmail({
            name: after.name,
            email: after.email,
            changes,
            loginUrl,
            changedBy: actor.email
          })
        );
      } else if (changes.length > 0) {
        console.warn("[admin-access] SMTP not configured — user access-change notification not sent.");
      }
    } catch (mailErr) {
      console.warn("[admin-access] access-change notification failed:", mailErr);
    }

    return NextResponse.json(after);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = requirePermission(req, "users.manage");
    return NextResponse.json(deleteAccessUser(actor, params.id));
  } catch (err) {
    return handleApiError(err);
  }
}
