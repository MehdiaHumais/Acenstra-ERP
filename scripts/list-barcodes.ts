// @ts-nocheck
import { getDb } from "@/server/db/connection";

getDb();
const db = getDb();
const rows = db
  .prepare(
    `SELECT pb.barcode, pb.format, pb.product_id, p.name, p.sku, p.category
     FROM product_barcodes pb
     JOIN products p ON p.id = pb.product_id
     ORDER BY pb.barcode`
  )
  .all() as Array<{ barcode: string; format: string; product_id: string; name: string; sku: string; category: string }>;

for (const r of rows) {
  console.log(`${r.barcode}\t${r.product_id}\t${r.sku}\t${r.name}`);
}
console.log("TOTAL:", rows.length);
process.exit(0);
