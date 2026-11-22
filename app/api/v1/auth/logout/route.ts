import { NextRequest, NextResponse } from "next/server";
import { handleApiError } from "@/server/core/http";
import { getSessionUser, getDefaultAdminUser, logoutSession } from "@/server/security/auth";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("ascentra_session")?.value || req.cookies.get("ascentra_refresh")?.value;
    const user = getSessionUser(req) || getDefaultAdminUser();

    if (token) {
      logoutSession(token, user);
    }

    const res = NextResponse.json({
      status: "signed_out",
      authenticated: false,
      user: null
    });

    res.cookies.delete("ascentra_session");
    res.cookies.delete("ascentra_refresh");

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
