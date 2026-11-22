import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempDbPath = path.join(os.tmpdir(), `ascentra-inbound-unit-${Date.now()}.sqlite`);
process.env.SQLITE_DB_PATH = tempDbPath;
process.env.SEED_DEMO_DATA = "true";

import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { AuthenticatedUser } from "../server/security/auth";
import { signAccessToken } from "../server/security/crypto";
import { findFefoLotForSku, listLots } from "../server/services/inventory-fefo.service";
import { POST as createShipmentRoute } from "../app/api/v1/inbound/shipments/route";
import { GET as getShipmentRoute } from "../app/api/v1/inbound/shipments/[id]/route";
import { POST as arrivalRoute } from "../app/api/v1/inbound/shipments/[id]/arrival/route";
import { POST as tempRoute } from "../app/api/v1/inbound/shipments/[id]/temperature-logs/route";
import { POST as receivingRoute } from "../app/api/v1/inbound/shipments/[id]/receiving/route";
import { POST as docUploadRoute } from "../app/api/v1/inbound/shipments/[id]/documents/route";
import { POST as docVerifyRoute } from "../app/api/v1/inbound/shipments/[id]/documents/[docId]/verify/route";
import { POST as qcRoute } from "../app/api/v1/inbound/shipments/[id]/quality-checks/route";
import { POST as acceptRoute } from "../app/api/v1/inbound/shipments/[id]/accept/route";
import { POST as quarantineRoute } from "../app/api/v1/inbound/shipments/[id]/quarantine/route";
import { GET as historyRoute } from "../app/api/v1/inbound/shipments/[id]/history/route";

const adminUser: AuthenticatedUser = {
  id: "USR-ADMIN",
  email: "elena.conti@ascentra.it",
  name: "Elena Conti",
  role: "super_admin",
  roles: ["super_admin"],
  store_id: null,
  warehouse: "Milan Cold Hub",
  mfa_enabled: true
};

const pickerUser: AuthenticatedUser = {
  id: "USR-PICK",
  email: "pietro.rossi@ascentra.it",
  name: "Pietro Rossi",
  role: "picker",
  roles: ["picker"],
  store_id: null,
  warehouse: "Milan Cold Hub",
  mfa_enabled: false
};

function makeReq(
  urlPath: string,
  method: string,
  user: AuthenticatedUser,
  body?: unknown,
  extraHeaders?: Record<string, string>
): NextRequest {
  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    roles: user.roles,
    warehouse: user.warehouse,
    store_id: user.store_id
  });
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    origin: "http://localhost:3000",
    host: "localhost:3000",
    ...(extraHeaders || {})
  };
  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
}

test.after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(tempDbPath + suffix, { force: true });
    } catch {}
  }
});

test("1. Expected shipment creation and arrival confirmation", async () => {
  const createRes = await createShipmentRoute(
    makeReq("/api/v1/inbound/shipments", "POST", adminUser, {
      supplier_name: "Nordic Fjord Seafood AS",
      supplier_id: "SUP-NOR-01",
      destination_warehouse: "Milan Cold Hub",
      expected_arrival: "2026-11-05T08:30:00.000Z",
      items: [{ sku: "SKU-SAL-001", product_name: "Norwegian Salmon Fillet", ordered_qty: 10 }]
    })
  );
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  const sid: string = created.shipment.id;
  assert.ok(sid);
  assert.equal(created.shipment.status, "expected");
  assert.equal(created.shipment.shipment.id, sid);

  const arrRes = await arrivalRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/arrival`, "POST", adminUser, {
      status: "arrived",
      actual_arrival: "2026-11-05T09:00:00.000Z"
    }),
    { params: { id: sid } }
  );
  assert.equal(arrRes.status, 200);
  const arrData = await arrRes.json();
  assert.equal(arrData.shipment.status, "arrived");
  assert.ok(arrData.shipment.actual_arrival);
});

test("2. Temperature excursion detection and Fahrenheit conversion", async () => {
  const createRes = await createShipmentRoute(
    makeReq("/api/v1/inbound/shipments", "POST", adminUser, {
      supplier_name: "Nordic Fjord Seafood AS",
      supplier_id: "SUP-NOR-01",
      destination_warehouse: "Milan Cold Hub",
      items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }]
    })
  );
  const { shipment } = await createRes.json();
  const sid: string = shipment.id;

  const tempRes = await tempRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/temperature-logs`, "POST", adminUser, {
      temp_c: 9.5,
      min_c: 0,
      max_c: 4,
      unit: "C",
      verified_by: "Giulia Romano"
    }),
    { params: { id: sid } }
  );
  assert.equal(tempRes.status, 201);
  const tempData = await tempRes.json();
  assert.equal(tempData.temperature_log.excursion, true);
});

test("3. Invalid manufacture/expiry dates and missing batch number rejected", async () => {
  const createRes = await createShipmentRoute(
    makeReq("/api/v1/inbound/shipments", "POST", adminUser, {
      supplier_name: "Nordic Fjord Seafood AS",
      supplier_id: "SUP-NOR-01",
      destination_warehouse: "Milan Cold Hub",
      items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }]
    })
  );
  const sid: string = (await createRes.json()).shipment.id;

  const badDatesRes = await receivingRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/receiving`, "POST", adminUser, {
      items: [
        {
          sku: "SKU-SAL-001",
          ordered_qty: 5,
          received_qty: 5,
          batches: [
            {
              supplier_batch: "SB-BADDATE",
              internal_lot: `LOT-BAD-${Date.now()}`,
              manufacture_date: "2026-12-10",
              expiry_date: "2026-10-01",
              quantity: 5,
              unit: "case"
            }
          ]
        }
      ]
    }),
    { params: { id: sid } }
  );
  assert.equal(badDatesRes.status, 400);
  const badDatesJson = await badDatesRes.json();
  assert.equal(badDatesJson.error.code, "INVALID_DATES");

  const noBatchRes = await receivingRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/receiving`, "POST", adminUser, {
      items: [
        {
          sku: "SKU-SAL-001",
          ordered_qty: 5,
          received_qty: 5,
          batches: [
            {
              internal_lot: `LOT-NOBATCH-${Date.now()}`,
              expiry_date: "2026-12-10",
              quantity: 5,
              unit: "case"
            }
          ]
        }
      ]
    }),
    { params: { id: sid } }
  );
  assert.equal(noBatchRes.status, 400);
  const noBatchJson = await noBatchRes.json();
  assert.equal(noBatchJson.error.code, "INVALID_BATCH");
});

test("4. Full receiving, catch-weight verification, and accepted stock into FEFO inventory", async () => {
  const createRes = await createShipmentRoute(
    makeReq("/api/v1/inbound/shipments", "POST", adminUser, {
      supplier_name: "Nordic Fjord Seafood AS",
      supplier_id: "SUP-NOR-01",
      destination_warehouse: "Milan Cold Hub",
      items: [{ sku: "SKU-SAL-001", ordered_qty: 5 }]
    })
  );
  const sid: string = (await createRes.json()).shipment.id;
  const lotCode = `LOT-FULL-${Date.now()}`;
  const sbCode = `SB-FULL-${Date.now()}`;

  const recvRes = await receivingRoute(
    makeReq(
      `/api/v1/inbound/shipments/${sid}/receiving`,
      "POST",
      adminUser,
      {
        items: [
          {
            sku: "SKU-SAL-001",
            ordered_qty: 5,
            received_qty: 5,
            actual_weight: 98.0,
            expected_weight: 100.0,
            weight_uom: "kg",
            weight_tolerance_pct: 5,
            batches: [
              {
                supplier_batch: sbCode,
                internal_lot: lotCode,
                manufacture_date: "2026-10-15",
                expiry_date: "2027-02-15",
                origin: "Norway",
                quantity: 5,
                unit: "case"
              }
            ]
          }
        ]
      },
      { "Idempotency-Key": `recv-unit-${sid}` }
    ),
    { params: { id: sid } }
  );
  assert.equal(recvRes.status, 200);
  const recvData = await recvRes.json();
  assert.equal(recvData.items[0].discrepancy_status, "match");
  assert.equal(recvData.items[0].weight_discrepancy_status, "within_tolerance");
  assert.equal(recvData.items[0].weight_variance_pct, -2);
  assert.equal(recvData.batches[0].origin, "Norway");

  // Duplicate receiving replay via Idempotency-Key
  const replayRes = await receivingRoute(
    makeReq(
      `/api/v1/inbound/shipments/${sid}/receiving`,
      "POST",
      adminUser,
      {
        items: [
          {
            sku: "SKU-SAL-001",
            ordered_qty: 5,
            received_qty: 5,
            actual_weight: 98.0,
            expected_weight: 100.0,
            weight_uom: "kg",
            weight_tolerance_pct: 5,
            batches: [
              {
                supplier_batch: sbCode,
                internal_lot: lotCode,
                manufacture_date: "2026-10-15",
                expiry_date: "2027-02-15",
                origin: "Norway",
                quantity: 5,
                unit: "case"
              }
            ]
          }
        ]
      },
      { "Idempotency-Key": `recv-unit-${sid}` }
    ),
    { params: { id: sid } }
  );
  assert.equal(replayRes.status, 200);
  assert.equal(replayRes.headers.get("x-idempotent-replay"), "true");

  const batchId: string = recvData.batches[0].id;
  const accRes = await acceptRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/accept`, "POST", adminUser, {
      accepted: [{ batch_id: batchId, accepted_qty: 5 }],
      bin: "COLD-A1"
    }),
    { params: { id: sid } }
  );
  assert.equal(accRes.status, 200);
  const accData = await accRes.json();
  assert.equal(accData.shipment.status, "accepted");

  const lots = listLots(adminUser);
  const matchingLot = lots.find((l) => l.batch_id === lotCode);
  assert.ok(matchingLot);
  assert.equal(matchingLot.quality_status, "released");
  assert.equal(matchingLot.quantity_cases, 5);
});

test("5. Partial receiving discrepancy and partial batch acceptance", async () => {
  const createRes = await createShipmentRoute(
    makeReq("/api/v1/inbound/shipments", "POST", adminUser, {
      supplier_name: "Nordic Fjord Seafood AS",
      supplier_id: "SUP-NOR-01",
      destination_warehouse: "Milan Cold Hub",
      items: [{ sku: "SKU-SAL-001", ordered_qty: 10 }]
    })
  );
  const sid: string = (await createRes.json()).shipment.id;
  const lotCode = `LOT-PART-${Date.now()}`;

  const recvRes = await receivingRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/receiving`, "POST", adminUser, {
      items: [
        {
          sku: "SKU-SAL-001",
          ordered_qty: 10,
          received_qty: 8,
          batches: [
            {
              supplier_batch: `SB-PART-${Date.now()}`,
              internal_lot: lotCode,
              expiry_date: "2027-03-01",
              quantity: 8,
              unit: "case"
            }
          ]
        }
      ]
    }),
    { params: { id: sid } }
  );
  const recvData = await recvRes.json();
  assert.equal(recvData.items[0].discrepancy_status, "short");

  // Accept only 6 of the 8 received cases -> partially_accepted
  const accRes = await acceptRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/accept`, "POST", adminUser, {
      accepted: [{ batch_id: recvData.batches[0].id, accepted_qty: 6 }],
      bin: "COLD-A2"
    }),
    { params: { id: sid } }
  );
  assert.equal(accRes.status, 200);
  const accData = await accRes.json();
  assert.equal(accData.shipment.status, "partially_accepted");
  assert.equal(accData.batches[0].accepted_qty, 6);
  assert.equal(accData.batches[0].rejected_qty, 2);
});

test("6. Document upload, expired certificate handling, quality check, quarantine, RBAC, and audit trail", async () => {
  const createRes = await createShipmentRoute(
    makeReq("/api/v1/inbound/shipments", "POST", adminUser, {
      supplier_name: "Nordic Fjord Seafood AS",
      supplier_id: "SUP-NOR-01",
      destination_warehouse: "Milan Cold Hub",
      items: [{ sku: "SKU-QUAR-999", ordered_qty: 5 }]
    })
  );
  const sid: string = (await createRes.json()).shipment.id;

  // Missing certificate derived initially
  const detail0 = await (await getShipmentRoute(makeReq(`/api/v1/inbound/shipments/${sid}`, "GET", adminUser), { params: { id: sid } })).json();
  assert.equal(detail0.documents.length, 0);
  assert.equal(detail0.exceptions.missing_documents, true);

  // Upload document -> starts in pending_review (upload != verification)
  const b64 = Buffer.from("Certificate PDF").toString("base64");
  const upRes = await docUploadRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/documents`, "POST", adminUser, {
      doc_type: "coa",
      file_name: "coa.pdf",
      mime_type: "application/pdf",
      content_base64: b64,
      expiry_date: "2020-01-01"
    }),
    { params: { id: sid } }
  );
  assert.equal(upRes.status, 201);
  const upData = await upRes.json();
  assert.equal(upData.document.status, "pending_review");
  const docId: string = upData.document.id;

  // Trying to mark an expired certificate as 'verified' is rejected with 400 DOCUMENT_EXPIRED
  const badVerify = await docVerifyRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/documents/${docId}/verify`, "POST", adminUser, {
      status: "verified"
    }),
    { params: { id: sid, docId } }
  );
  assert.equal(badVerify.status, 400);

  // Marking it as 'expired' succeeds
  const expVerify = await docVerifyRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/documents/${docId}/verify`, "POST", adminUser, {
      status: "expired",
      review_notes: "Certificate expired"
    }),
    { params: { id: sid, docId } }
  );
  assert.equal(expVerify.status, 200);
  assert.equal((await expVerify.json()).document.status, "expired");

  // Record failed quality check
  const qcRes = await qcRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/quality-checks`, "POST", adminUser, {
      check_type: "visual",
      result: "fail",
      notes: "Ice crystals detected"
    }),
    { params: { id: sid } }
  );
  assert.equal(qcRes.status, 201);
  assert.equal((await qcRes.json()).quality_check.result, "fail");

  // Receive goods and quarantine
  const quarLot = `LOT-QUAR-${Date.now()}`;
  await receivingRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/receiving`, "POST", adminUser, {
      items: [
        {
          sku: "SKU-QUAR-999",
          ordered_qty: 5,
          received_qty: 5,
          batches: [
            {
              supplier_batch: `SB-Q-${Date.now()}`,
              internal_lot: quarLot,
              expiry_date: "2027-04-01",
              quantity: 5,
              unit: "case"
            }
          ]
        }
      ]
    }),
    { params: { id: sid } }
  );

  // Unauthorized picker cannot accept/quarantine
  const unauthAccept = await acceptRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/accept`, "POST", pickerUser, {
      accepted: [],
      bin: "COLD-A1"
    }),
    { params: { id: sid } }
  );
  assert.equal(unauthAccept.status, 403);

  // Admin quarantines stock
  const quarRes = await quarantineRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/quarantine`, "POST", adminUser, {
      bin: "Quarantine",
      reason: "Failed visual inspection & expired COA"
    }),
    { params: { id: sid } }
  );
  assert.equal(quarRes.status, 200);
  assert.equal((await quarRes.json()).shipment.status, "quarantined");

  // Quarantined lot is NOT available for FEFO picking
  const fefoMatch = findFefoLotForSku("SKU-QUAR-999", 1);
  assert.equal(fefoMatch, null);

  // Audit history includes shipment and child events
  const histRes = await historyRoute(
    makeReq(`/api/v1/inbound/shipments/${sid}/history`, "GET", adminUser),
    { params: { id: sid } }
  );
  assert.equal(histRes.status, 200);
  const histData = await histRes.json();
  assert.ok(Array.isArray(histData.history));
  assert.ok(histData.history.length >= 4);
});
