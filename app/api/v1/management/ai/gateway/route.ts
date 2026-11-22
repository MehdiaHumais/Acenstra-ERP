import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import {
  getSanitizedOmniRouteConfig,
  testOmniRouteConnection,
  discoverOmniRouteModels,
  KNOWN_MODEL_ALIASES,
} from "@/lib/ai";

/**
 * GET /api/v1/management/ai/gateway
 * Returns sanitized OmniRoute configuration and known model aliases for admin UI.
 */
export async function GET(req: NextRequest) {
  try {
    authorizeRequest(req, "settings.manage");
    const sanitizedConfig = getSanitizedOmniRouteConfig();
    return NextResponse.json({
      gateway: sanitizedConfig,
      aliases: KNOWN_MODEL_ALIASES,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/v1/management/ai/gateway
 * Actions:
 *  - { action: "test_connection" }
 *  - { action: "discover_models" }
 */
export async function POST(req: NextRequest) {
  try {
    authorizeRequest(req, "settings.manage");
    const body = await req.json().catch(() => ({}));
    const action = body?.action || "test_connection";

    if (action === "test_connection") {
      const result = await testOmniRouteConnection();
      return NextResponse.json({ test: result });
    }

    if (action === "discover_models") {
      const models = await discoverOmniRouteModels(true);
      return NextResponse.json({
        total: models.length,
        models,
      });
    }

    return NextResponse.json(
      { error: `Unknown action '${action}'. Supported: 'test_connection', 'discover_models'.` },
      { status: 400 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
