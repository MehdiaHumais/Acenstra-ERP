import { NextRequest, NextResponse } from "next/server";
import {
  clearAllOperationalData,
  getDb,
  resetToProposalDemoData
} from "@/server/db/connection";
import { cacheQueue } from "@/server/core/cache-queue";
import { authorizeRequest, handleApiError } from "@/server/core/http";

export async function GET() {
  try {
    const db = getDb();
    const row = db.prepare(`SELECT COUNT(*) as c FROM products`).get() as { c: number };
    const engineName = (process.env.DB_ENGINE || "sqlite").trim().toLowerCase();
    const isPostgres = ["postgres", "postgresql", "supabase"].includes(engineName);
    return NextResponse.json({
      status: "ok",
      service: "Ascentra Food Distribution ERP API",
      version: "1.0.0",
      database: {
        status: "connected",
        engine: isPostgres ? "supabase-postgres" : "sqlite-wal",
        active_skus: Number(row.c)
      },
      infrastructure: cacheQueue.stats(),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        message: err instanceof Error ? err.message : "Database check failed"
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    // Destructive dataset operations are never public, even though GET /health is.
    const actor = authorizeRequest(req, "settings.manage");
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action === "clear_all_data") {
      clearAllOperationalData();
      cacheQueue.invalidatePrefix("");
      return NextResponse.json({
        status: "ok",
        mode: "empty",
        message: `All operational data cleared by ${actor.email}. Database is now empty.`
      });
    }
    if (body.action === "restore_demo_data") {
      resetToProposalDemoData();
      cacheQueue.invalidatePrefix("");
      const db = getDb();
      const products = db.prepare(`SELECT COUNT(*) as c FROM products`).get() as { c: number };
      return NextResponse.json({
        status: "ok",
        mode: "demo",
        active_skus: Number(products.c),
        message: `Proposal demo dataset restored by ${actor.email}.`
      });
    }
    return NextResponse.json({ status: "error", message: "Invalid action" }, { status: 400 });
  } catch (err) {
    return handleApiError(err);
  }
}
