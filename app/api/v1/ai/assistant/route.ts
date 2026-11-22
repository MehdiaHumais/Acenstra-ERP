import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/server/core/http";
import { askErpAssistant, getLiveErpSnapshot } from "@/server/services/ai-assistant.service";

/**
 * GET /api/v1/ai/assistant
 * Returns live database stats so the chat assistant widget can display real-time counters.
 */
export async function GET() {
  try {
    const snapshot = getLiveErpSnapshot();
    return NextResponse.json({
      stats: snapshot.stats,
      sampleCustomers: snapshot.recentCustomers.slice(0, 5),
      sampleOrders: snapshot.recentOrders.slice(0, 5),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/v1/ai/assistant
 * Body: { messages: Array<{ role: "user" | "assistant", content: string }> }
 * Grounded query through OmniRoute AI Gateway with live ERP state.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawMessages = Array.isArray(body?.messages) ? body.messages : [];

    if (rawMessages.length === 0 && typeof body?.prompt === "string" && body.prompt.trim()) {
      rawMessages.push({ role: "user", content: body.prompt.trim() });
    }

    if (rawMessages.length === 0) {
      return NextResponse.json(
        { error: "Missing 'messages' or 'prompt' in request body." },
        { status: 400 }
      );
    }

    // Sanitize messages
    const messages = rawMessages
      .filter((m: any) => m && typeof m.content === "string" && m.content.trim())
      .slice(-10) // Keep last 10 messages for conversation context
      .map((m: any) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: String(m.content).trim(),
      }));

    const response = await askErpAssistant(messages);
    return NextResponse.json(response);
  } catch (err) {
    return handleApiError(err);
  }
}
