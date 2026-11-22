import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, handleApiError } from "@/server/core/http";
import { listBankStatements } from "@/server/services/finance.service";

export async function GET(req: NextRequest) {
  try {
    const actor = authorizeRequest(req, "finance:read");
    const statements = listBankStatements();
    return NextResponse.json({ statements, count: statements.length });
  } catch (err) {
    return handleApiError(err);
  }
}
