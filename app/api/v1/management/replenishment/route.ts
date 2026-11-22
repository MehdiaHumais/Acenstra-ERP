import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { generateReplenishmentSuggestions } from "@/server/services/management-ai.service";

export async function GET(req: NextRequest) {
  try {
    const user = authorizeRequest(req, "purchase_orders.read");
    const suggestions = await generateReplenishmentSuggestions(user);
    return NextResponse.json({ suggestions });
  } catch (err) {
    return handleApiError(err);
  }
}
