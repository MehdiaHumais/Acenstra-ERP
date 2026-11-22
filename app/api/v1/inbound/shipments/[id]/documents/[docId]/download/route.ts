import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest, authorizeRequestAnyOf, handleApiError } from "@/server/core/http";
import { documentDownloadPath, getShipmentDetail } from "@/server/services/inbound.service";

export async function GET(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  try {
    const actor = authorizeRequestAnyOf(req, ["inbound.documents", "inbound.quality", "inbound.decision"]);
    const fullPath = documentDownloadPath(actor, params.id, params.docId);
    const detail = getShipmentDetail(actor, params.id);
    const doc = detail.documents.find((d) => d.id === params.docId);
    const buffer = fs.readFileSync(fullPath);
    const res = new NextResponse(buffer);
    res.headers.set("Content-Type", doc?.mime_type || "application/octet-stream");
    res.headers.set("Content-Disposition", `attachment; filename="${doc?.file_name || "document"}"`);
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
