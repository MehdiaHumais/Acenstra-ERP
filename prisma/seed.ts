// ============================================================================
// Ascentra Food Distribution ERP — Idempotent Database Seed Script
// Seeds: 3 Suppliers, 20 Products, 2 Warehouses, 10 Customers, plus
// complete supporting RBAC, SKUs, UOMs, Zones, Bins, Lots, Stock Balances,
// Purchase Orders, ASNs, Quality Checks, Orders, Invoices, Payments,
// Cold-Chain Temperature Logs, Audit Events, AI Action Logs, Recalls & CAPA.
// ============================================================================

import { PrismaClient, Prisma } from "@prisma/client";
import * as crypto from "node:crypto";

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function main() {
  console.log("🌱 Starting Ascentra ERP Idempotent Database Seed...");

  const demoPassword = process.env.DEMO_ADMIN_PASSWORD || "AscentraDemoPassword2026!";
  const passwordHash = hashPassword(demoPassword);

  // --------------------------------------------------------------------------
  // 1. Roles & Permissions (RBAC)
  // --------------------------------------------------------------------------
  console.log("-> Seeding Roles & Permissions...");

  const permissionsData = [
    { code: "master:read", name: "Read Master Data", category: "Master Data" },
    { code: "master:write", name: "Modify Master Data", category: "Master Data" },
    { code: "inventory:read", name: "View Inventory & Stock", category: "Inventory" },
    { code: "inventory:adjust", name: "Adjust Physical Inventory", category: "Inventory" },
    { code: "orders:read", name: "View Customer Orders", category: "Sales" },
    { code: "orders:write", name: "Create & Update Orders", category: "Sales" },
    { code: "orders:credit_override", name: "Override Credit Limit", category: "Sales" },
    { code: "quality:inspect", name: "Perform Quality Check", category: "Quality" },
    { code: "quality:quarantine", name: "Quarantine Suspect Lots", category: "Quality" },
    { code: "finance:invoices", name: "Manage Electronic Invoices", category: "Finance" },
    { code: "finance:payments", name: "Reconcile Payments", category: "Finance" },
    { code: "ai:insights", name: "View AI Analytics", category: "AI & Intelligence" },
    { code: "ai:approve", name: "Approve Governed AI Actions", category: "AI & Intelligence" },
    { code: "audit:read", name: "Inspect Audit Trail", category: "Governance" },
  ];

  const permissions: Record<string, string> = {};
  for (const p of permissionsData) {
    const record = await prisma.permission.upsert({
      where: { code: p.code },
      update: { name: p.name, category: p.category },
      create: p,
    });
    permissions[p.code] = record.id;
  }

  const rolesData = [
    { code: "SUPER_ADMIN", name: "Super Admin", description: "Unrestricted operational, financial, technical and administrative access" },
    { code: "WAREHOUSE_MANAGER", name: "Warehouse Manager", description: "Stock oversight, adjustments, receiving, purchase orders and dispatch" },
    { code: "PICKER", name: "Picker", description: "Warehouse inventory viewing, picking lists execution and fulfillment task status" },
    { code: "DRIVER", name: "Driver", description: "Assigned deliveries, route manifests, delivery completion and temperature logging" },
    { code: "FINANCE", name: "Finance", description: "Invoicing, payments reconciliation and SdI fiscal compliance" },
    { code: "SALES", name: "Sales", description: "Customer accounts, order intake, catalog pricing and dispatch visibility" },
    { code: "QA", name: "QA", description: "Inbound quality inspections, quarantine controls, recall procedures and CAPA logs" },
    { code: "STORE_VENDOR", name: "Store Vendor", description: "Own franchise inventory levels, order placement, delivery tracking and invoices" },
    { code: "CEO", name: "CEO", description: "Executive dashboards, macro analytics, audit trail reports and AI strategic insights" },
    // Backward compatibility aliases
    { code: "ADMINISTRATOR", name: "Administrator", description: "Legacy alias for Super Admin" },
    { code: "MANAGEMENT", name: "Management Executive", description: "Legacy alias for CEO" },
    { code: "PROCUREMENT", name: "Procurement Specialist", description: "Legacy alias for Sales/Procurement" },
    { code: "WAREHOUSE_STAFF", name: "Warehouse Staff", description: "Legacy alias for Warehouse Manager/Picker" },
    { code: "STORE_USER", name: "Store User", description: "Legacy alias for Store Vendor" },
  ];

  const roles: Record<string, string> = {};
  for (const r of rolesData) {
    const record = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description },
      create: r,
    });
    roles[r.code] = record.id;
  }

  // Grant all permissions to SUPER_ADMIN & ADMINISTRATOR
  for (const permId of Object.values(permissions)) {
    for (const adminRole of ["SUPER_ADMIN", "ADMINISTRATOR"]) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: roles[adminRole],
            permissionId: permId,
          },
        },
        update: {},
        create: {
          roleId: roles[adminRole],
          permissionId: permId,
        },
      });
    }
  }

  // --------------------------------------------------------------------------
  // 2. Demo Development Users Covering The 9 Roles
  // --------------------------------------------------------------------------
  console.log("-> Seeding Users...");

  const usersData = [
    { email: "elena.conti@ascentra.com", fullName: "Elena Conti", phone: "+39 02 8901 2345", roleCode: "SUPER_ADMIN", warehouse: "Milan Cold Hub" },
    { email: "marco.bellini@ascentra.com", fullName: "Marco Bellini", phone: "+39 02 8901 2346", roleCode: "WAREHOUSE_MANAGER", warehouse: "Milan Cold Hub" },
    { email: "pietro.rossi@ascentra.com", fullName: "Pietro Rossi", phone: "+39 02 8901 2347", roleCode: "PICKER", warehouse: "Milan Cold Hub" },
    { email: "davide.galli@ascentra.com", fullName: "Davide Galli", phone: "+39 02 8901 2348", roleCode: "DRIVER", warehouse: "Milan Cold Hub" },
    { email: "matteo.ricci@ascentra.com", fullName: "Matteo Ricci", phone: "+39 02 8901 2349", roleCode: "FINANCE", warehouse: "Milan Cold Hub" },
    { email: "sofia.greco@ascentra.com", fullName: "Sofia Greco", phone: "+39 02 8901 2350", roleCode: "SALES", warehouse: "Milan Cold Hub" },
    { email: "giulia.romano@ascentra.com", fullName: "Giulia Romano", phone: "+39 02 8901 2351", roleCode: "QA", warehouse: "Milan Cold Hub" },
    { email: "chiara.moretti@store-navigli.it", fullName: "Chiara Moretti", phone: "+39 02 8901 2352", roleCode: "STORE_VENDOR", warehouse: "Milan Cold Hub", storeId: "STR-MIL-01" },
    { email: "lorenzo.ferrari@ascentra.com", fullName: "Lorenzo Ferrari", phone: "+39 02 8901 2353", roleCode: "CEO", warehouse: "Milan Cold Hub" },
  ];

  const users: Record<string, string> = {};
  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { fullName: u.fullName, phone: u.phone, warehouse: u.warehouse, storeId: u.storeId ?? null },
      create: {
        email: u.email,
        fullName: u.fullName,
        passwordHash,
        phone: u.phone,
        warehouse: u.warehouse,
        storeId: u.storeId ?? null,
        mfaEnabled: true,
      },
    });
    users[u.email] = user.id;

    await prisma.userRole.upsert({
      where: {
        userId_roleId: {
          userId: user.id,
          roleId: roles[u.roleCode],
        },
      },
      update: {},
      create: {
        userId: user.id,
        roleId: roles[u.roleCode],
        assignedBy: "system_init",
      },
    });
  }

  // --------------------------------------------------------------------------
  // 3. Units of Measure (UOM)
  // --------------------------------------------------------------------------
  console.log("-> Seeding Units of Measure...");

  const uomData = [
    { code: "KG", name: "Kilogram", category: "Weight", conversionFactor: new Prisma.Decimal("1.0000"), isBaseUnit: true },
    { code: "CASE", name: "Standard Case (10 kg)", category: "Packaging", conversionFactor: new Prisma.Decimal("10.0000"), isBaseUnit: false },
    { code: "EACH", name: "Single Consumer Pack", category: "Count", conversionFactor: new Prisma.Decimal("1.0000"), isBaseUnit: true },
    { code: "LITER", name: "Liter", category: "Volume", conversionFactor: new Prisma.Decimal("1.0000"), isBaseUnit: true },
    { code: "PALLET", name: "Standard EUR Pallet", category: "Logistics", conversionFactor: new Prisma.Decimal("600.0000"), isBaseUnit: false },
  ];

  const uoms: Record<string, string> = {};
  for (const u of uomData) {
    const record = await prisma.uOM.upsert({
      where: { code: u.code },
      update: { name: u.name, conversionFactor: u.conversionFactor },
      create: u,
    });
    uoms[u.code] = record.id;
  }

  // --------------------------------------------------------------------------
  // 4. Warehouses, Zones & Bins (Exactly 2 Warehouses)
  // --------------------------------------------------------------------------
  console.log("-> Seeding Warehouses, Zones & Bins (2 Warehouses)...");

  const warehousesData = [
    {
      code: "WH-MIL-01",
      name: "Milan Central Cold Distribution Hub",
      addressLine: "Via Stephenson 42",
      city: "Milan",
      postalCode: "20157",
      country: "Italy",
      totalCapacity: new Prisma.Decimal("45000.00"),
    },
    {
      code: "WH-VER-02",
      name: "Verona Cross-Dock Logistics Center",
      addressLine: "Quadrante Europa, Viale delle Nazioni 10",
      city: "Verona",
      postalCode: "37135",
      country: "Italy",
      totalCapacity: new Prisma.Decimal("30000.00"),
    },
  ];

  const warehouses: Record<string, string> = {};
  for (const w of warehousesData) {
    const record = await prisma.warehouse.upsert({
      where: { code: w.code },
      update: { name: w.name, totalCapacity: w.totalCapacity },
      create: w,
    });
    warehouses[w.code] = record.id;
  }

  const zonesData = [
    // Milan Hub Zones
    { code: "Z-MIL-CHILL-01", warehouseId: warehouses["WH-MIL-01"], name: "Chilled Dairy & Produce", zoneType: "CHILLED" as const, minTempC: new Prisma.Decimal("0.5"), maxTempC: new Prisma.Decimal("4.0") },
    { code: "Z-MIL-FROZ-01", warehouseId: warehouses["WH-MIL-01"], name: "Deep Frozen Seafood & Meat", zoneType: "FROZEN" as const, minTempC: new Prisma.Decimal("-24.0"), maxTempC: new Prisma.Decimal("-18.0") },
    { code: "Z-MIL-AMB-01", warehouseId: warehouses["WH-MIL-01"], name: "Ambient Dry Goods & Pasta", zoneType: "AMBIENT" as const, minTempC: new Prisma.Decimal("15.0"), maxTempC: new Prisma.Decimal("22.0") },
    { code: "Z-MIL-QUAR-01", warehouseId: warehouses["WH-MIL-01"], name: "Quarantine & Quality Hold", zoneType: "QUARANTINE" as const, minTempC: new Prisma.Decimal("1.0"), maxTempC: new Prisma.Decimal("6.0") },
    // Verona Hub Zones
    { code: "Z-VER-CHILL-01", warehouseId: warehouses["WH-VER-02"], name: "Verona Chilled Dock", zoneType: "CHILLED" as const, minTempC: new Prisma.Decimal("1.0"), maxTempC: new Prisma.Decimal("4.0") },
    { code: "Z-VER-FROZ-01", warehouseId: warehouses["WH-VER-02"], name: "Verona Deep Freeze", zoneType: "FROZEN" as const, minTempC: new Prisma.Decimal("-22.0"), maxTempC: new Prisma.Decimal("-18.0") },
    { code: "Z-VER-AMB-01", warehouseId: warehouses["WH-VER-02"], name: "Verona Ambient Storage", zoneType: "AMBIENT" as const, minTempC: new Prisma.Decimal("14.0"), maxTempC: new Prisma.Decimal("20.0") },
  ];

  const zones: Record<string, string> = {};
  for (const z of zonesData) {
    const record = await prisma.zone.upsert({
      where: { code: z.code },
      update: { name: z.name, minTempC: z.minTempC, maxTempC: z.maxTempC },
      create: z,
    });
    zones[z.code] = record.id;
  }

  const binsData = [
    // Milan Bins
    { code: "BIN-MIL-CH-A01", zoneId: zones["Z-MIL-CHILL-01"], aisle: "A", rack: "01", shelf: "1", position: "A", maxWeightKg: new Prisma.Decimal("1200.0") },
    { code: "BIN-MIL-CH-A02", zoneId: zones["Z-MIL-CHILL-01"], aisle: "A", rack: "01", shelf: "2", position: "B", maxWeightKg: new Prisma.Decimal("1200.0") },
    { code: "BIN-MIL-FR-B01", zoneId: zones["Z-MIL-FROZ-01"], aisle: "B", rack: "02", shelf: "1", position: "A", maxWeightKg: new Prisma.Decimal("1500.0") },
    { code: "BIN-MIL-FR-B02", zoneId: zones["Z-MIL-FROZ-01"], aisle: "B", rack: "02", shelf: "2", position: "B", maxWeightKg: new Prisma.Decimal("1500.0") },
    { code: "BIN-MIL-AM-C01", zoneId: zones["Z-MIL-AMB-01"], aisle: "C", rack: "03", shelf: "1", position: "A", maxWeightKg: new Prisma.Decimal("2000.0") },
    { code: "BIN-MIL-AM-C02", zoneId: zones["Z-MIL-AMB-01"], aisle: "C", rack: "03", shelf: "2", position: "B", maxWeightKg: new Prisma.Decimal("2000.0") },
    { code: "BIN-MIL-QU-Q01", zoneId: zones["Z-MIL-QUAR-01"], aisle: "Q", rack: "99", shelf: "1", position: "Q", maxWeightKg: new Prisma.Decimal("1000.0") },
    // Verona Bins
    { code: "BIN-VER-CH-A01", zoneId: zones["Z-VER-CHILL-01"], aisle: "A", rack: "01", shelf: "1", position: "A", maxWeightKg: new Prisma.Decimal("1200.0") },
    { code: "BIN-VER-FR-B01", zoneId: zones["Z-VER-FROZ-01"], aisle: "B", rack: "01", shelf: "1", position: "A", maxWeightKg: new Prisma.Decimal("1500.0") },
    { code: "BIN-VER-AM-C01", zoneId: zones["Z-VER-AMB-01"], aisle: "C", rack: "01", shelf: "1", position: "A", maxWeightKg: new Prisma.Decimal("2000.0") },
  ];

  const bins: Record<string, string> = {};
  for (const b of binsData) {
    const record = await prisma.bin.upsert({
      where: { code: b.code },
      update: { maxWeightKg: b.maxWeightKg },
      create: b,
    });
    bins[b.code] = record.id;
  }

  // --------------------------------------------------------------------------
  // 5. Suppliers (Exactly 3 Suppliers)
  // --------------------------------------------------------------------------
  console.log("-> Seeding Suppliers (3 Suppliers)...");

  const suppliersData = [
    {
      code: "SUP-NOR-01",
      name: "Nordic Fjord Seafood AS",
      legalName: "Nordic Fjord Seafood AS",
      vatNumber: "NO987654321MVA",
      contactEmail: "orders@nordicfjord.no",
      contactPhone: "+47 55 12 34 56",
      addressLine: "Havnegata 14",
      city: "Bergen",
      postalCode: "5003",
      country: "Norway",
      paymentTerms: "Net 30",
      onTimeDeliveryRate: new Prisma.Decimal("98.40"),
      qualityScore: new Prisma.Decimal("98.00"),
      certificationsJson: ["IFS Food", "MSC Certified", "HACCP"],
    },
    {
      code: "SUP-LOM-02",
      name: "Latteria Sociale Mantovana",
      legalName: "Latteria Sociale Mantovana Scarl",
      vatNumber: "IT01234560201",
      contactEmail: "ordini@latteriamantovana.it",
      contactPhone: "+39 0376 987654",
      addressLine: "Strada Provinciale 28",
      city: "Mantova",
      postalCode: "46100",
      country: "Italy",
      paymentTerms: "Net 30",
      onTimeDeliveryRate: new Prisma.Decimal("96.80"),
      qualityScore: new Prisma.Decimal("95.50"),
      certificationsJson: ["DOP Consortium", "BRC Food", "ISO 22000"],
    },
    {
      code: "SUP-SIC-03",
      name: "Cooperativa Agricola Sud Terre",
      legalName: "Cooperativa Agricola Sud Terre Soc. Coop.",
      vatNumber: "IT09876540876",
      contactEmail: "logistica@sudterre.it",
      contactPhone: "+39 095 7654321",
      addressLine: "Contrada Passo Martino snc",
      city: "Catania",
      postalCode: "95121",
      country: "Italy",
      paymentTerms: "Net 15",
      onTimeDeliveryRate: new Prisma.Decimal("97.20"),
      qualityScore: new Prisma.Decimal("96.00"),
      certificationsJson: ["GlobalGAP", "Bio Organic EU", "HACCP"],
    },
  ];

  const suppliers: Record<string, string> = {};
  for (const s of suppliersData) {
    const record = await prisma.supplier.upsert({
      where: { code: s.code },
      update: { name: s.name, onTimeDeliveryRate: s.onTimeDeliveryRate },
      create: s,
    });
    suppliers[s.code] = record.id;
  }

  // --------------------------------------------------------------------------
  // 6. Products & SKUs (Exactly 20 Products)
  // --------------------------------------------------------------------------
  console.log("-> Seeding Products & SKUs (20 Products)...");

  const productsData = [
    // Seafood (Supplier: Nordic Fjord)
    {
      code: "PRD-SALMON-NOR",
      name: "Norwegian Atlantic Salmon Fillet (Trim E)",
      category: "Seafood",
      supplierCode: "SUP-NOR-01",
      storageCondition: "CHILLED" as const,
      shelfLifeDays: 14,
      originCountry: "Norway",
      allergenInfo: "Fish",
      skuCode: "SKU-SAL-001",
      barcode: "8001234560010",
      packSize: "5 kg Box",
      grossWeightKg: new Prisma.Decimal("5.300"),
      netWeightKg: new Prisma.Decimal("5.000"),
      unitPrice: new Prisma.Decimal("18.90"),
      landedCost: new Prisma.Decimal("13.20"),
      uomCode: "KG",
    },
    {
      code: "PRD-COD-LOIN",
      name: "Atlantic Cod Loins Skinless IQF",
      category: "Seafood",
      supplierCode: "SUP-NOR-01",
      storageCondition: "FROZEN" as const,
      shelfLifeDays: 360,
      originCountry: "Norway",
      allergenInfo: "Fish",
      skuCode: "SKU-COD-002",
      barcode: "8001234560027",
      packSize: "10 kg Master Carton",
      grossWeightKg: new Prisma.Decimal("10.500"),
      netWeightKg: new Prisma.Decimal("10.000"),
      unitPrice: new Prisma.Decimal("14.50"),
      landedCost: new Prisma.Decimal("9.80"),
      uomCode: "KG",
    },
    // Dairy & Cheeses (Supplier: Latteria Mantovana)
    {
      code: "PRD-PARMIGIANO-24",
      name: "Parmigiano Reggiano DOP 24 Mesi Wheel Portion",
      category: "Dairy & Cheese",
      supplierCode: "SUP-LOM-02",
      storageCondition: "CHILLED" as const,
      shelfLifeDays: 180,
      originCountry: "Italy",
      allergenInfo: "Milk",
      skuCode: "SKU-PARM-003",
      barcode: "8001234560034",
      packSize: "1 kg Vacuum Pack",
      grossWeightKg: new Prisma.Decimal("1.020"),
      netWeightKg: new Prisma.Decimal("1.000"),
      unitPrice: new Prisma.Decimal("22.50"),
      landedCost: new Prisma.Decimal("16.80"),
      uomCode: "KG",
    },
    {
      code: "PRD-MOZZ-BUFALA",
      name: "Mozzarella di Bufala Campana DOP",
      category: "Dairy & Cheese",
      supplierCode: "SUP-LOM-02",
      storageCondition: "CHILLED" as const,
      shelfLifeDays: 21,
      originCountry: "Italy",
      allergenInfo: "Milk",
      skuCode: "SKU-MOZZ-004",
      barcode: "8001234560041",
      packSize: "12 x 250g Tub",
      grossWeightKg: new Prisma.Decimal("3.500"),
      netWeightKg: new Prisma.Decimal("3.000"),
      unitPrice: new Prisma.Decimal("13.80"),
      landedCost: new Prisma.Decimal("9.20"),
      uomCode: "KG",
    },
    {
      code: "PRD-BURRATA-PUGLIA",
      name: "Burrata Artigianale Pugliese 250g",
      category: "Dairy & Cheese",
      supplierCode: "SUP-LOM-02",
      storageCondition: "CHILLED" as const,
      shelfLifeDays: 16,
      originCountry: "Italy",
      allergenInfo: "Milk",
      skuCode: "SKU-BURR-005",
      barcode: "8001234560058",
      packSize: "8 x 250g Tub",
      grossWeightKg: new Prisma.Decimal("2.400"),
      netWeightKg: new Prisma.Decimal("2.000"),
      unitPrice: new Prisma.Decimal("15.20"),
      landedCost: new Prisma.Decimal("10.50"),
      uomCode: "KG",
    },
    // Meat & Charcuterie
    {
      code: "PRD-PROSCIUTTO-PARMA",
      name: "Prosciutto di Parma DOP 18 Mesi Boneless",
      category: "Meat & Charcuterie",
      supplierCode: "SUP-LOM-02",
      storageCondition: "CHILLED" as const,
      shelfLifeDays: 120,
      originCountry: "Italy",
      allergenInfo: null,
      skuCode: "SKU-PROSC-006",
      barcode: "8001234560065",
      packSize: "7.5 kg Whole Piece",
      grossWeightKg: new Prisma.Decimal("7.650"),
      netWeightKg: new Prisma.Decimal("7.500"),
      unitPrice: new Prisma.Decimal("28.90"),
      landedCost: new Prisma.Decimal("21.00"),
      uomCode: "KG",
    },
    {
      code: "PRD-POULTRY-BREAST",
      name: "Fresh Free-Range Chicken Breast Fillets",
      category: "Meat & Charcuterie",
      supplierCode: "SUP-LOM-02",
      storageCondition: "CHILLED" as const,
      shelfLifeDays: 10,
      originCountry: "Italy",
      allergenInfo: null,
      skuCode: "SKU-POULT-007",
      barcode: "8001234560072",
      packSize: "5 kg MAP Tray",
      grossWeightKg: new Prisma.Decimal("5.250"),
      netWeightKg: new Prisma.Decimal("5.000"),
      unitPrice: new Prisma.Decimal("9.80"),
      landedCost: new Prisma.Decimal("6.70"),
      uomCode: "KG",
    },
    {
      code: "PRD-BEEF-RIBEYE",
      name: "Dry-Aged Italian Scottona Ribeye Steak",
      category: "Meat & Charcuterie",
      supplierCode: "SUP-LOM-02",
      storageCondition: "CHILLED" as const,
      shelfLifeDays: 28,
      originCountry: "Italy",
      allergenInfo: null,
      skuCode: "SKU-BEEF-008",
      barcode: "8001234560089",
      packSize: "4 kg Vacuum Pack",
      grossWeightKg: new Prisma.Decimal("4.150"),
      netWeightKg: new Prisma.Decimal("4.000"),
      unitPrice: new Prisma.Decimal("34.50"),
      landedCost: new Prisma.Decimal("25.00"),
      uomCode: "KG",
    },
    // Bakery & Pasta (Ambient)
    {
      code: "PRD-TRUFFLE-PASTA",
      name: "Egg Tagliatelle with Black Winter Truffle",
      category: "Bakery & Pasta",
      supplierCode: "SUP-SIC-03",
      storageCondition: "AMBIENT" as const,
      shelfLifeDays: 365,
      originCountry: "Italy",
      allergenInfo: "Eggs, Gluten",
      skuCode: "SKU-TRUF-009",
      barcode: "8001234560096",
      packSize: "12 x 500g Box",
      grossWeightKg: new Prisma.Decimal("6.400"),
      netWeightKg: new Prisma.Decimal("6.000"),
      unitPrice: new Prisma.Decimal("12.40"),
      landedCost: new Prisma.Decimal("7.80"),
      uomCode: "KG",
    },
    {
      code: "PRD-PASTA-GRAGNANO",
      name: "Artisan Spaghetti di Gragnano IGP Bronze Die",
      category: "Bakery & Pasta",
      supplierCode: "SUP-SIC-03",
      storageCondition: "AMBIENT" as const,
      shelfLifeDays: 730,
      originCountry: "Italy",
      allergenInfo: "Gluten",
      skuCode: "SKU-SPAG-010",
      barcode: "8001234560102",
      packSize: "10 x 1 kg Case",
      grossWeightKg: new Prisma.Decimal("10.300"),
      netWeightKg: new Prisma.Decimal("10.000"),
      unitPrice: new Prisma.Decimal("3.80"),
      landedCost: new Prisma.Decimal("2.10"),
      uomCode: "KG",
    },
    // Oils & Condiments (Ambient)
    {
      code: "PRD-OLIVE-OIL-EVO",
      name: "Extra Virgin Cold-Pressed Olive Oil 5L Tin",
      category: "Packaged Goods",
      supplierCode: "SUP-SIC-03",
      storageCondition: "AMBIENT" as const,
      shelfLifeDays: 540,
      originCountry: "Italy",
      allergenInfo: null,
      skuCode: "SKU-OIL-011",
      barcode: "8001234560119",
      packSize: "5 L Tin",
      grossWeightKg: new Prisma.Decimal("4.800"),
      netWeightKg: new Prisma.Decimal("4.600"),
      unitPrice: new Prisma.Decimal("14.50"),
      landedCost: new Prisma.Decimal("9.80"),
      uomCode: "LITER",
    },
    {
      code: "PRD-BALSAMIC-MODENA",
      name: "Aceto Balsamico Tradizionale di Modena DOP 250ml",
      category: "Packaged Goods",
      supplierCode: "SUP-LOM-02",
      storageCondition: "AMBIENT" as const,
      shelfLifeDays: 1095,
      originCountry: "Italy",
      allergenInfo: "Sulphites",
      skuCode: "SKU-BALS-012",
      barcode: "8001234560126",
      packSize: "250 ml Glass Bottle",
      grossWeightKg: new Prisma.Decimal("0.550"),
      netWeightKg: new Prisma.Decimal("0.250"),
      unitPrice: new Prisma.Decimal("45.00"),
      landedCost: new Prisma.Decimal("32.00"),
      uomCode: "EACH",
    },
    {
      code: "PRD-TOMATO-SAN-MARZ",
      name: "San Marzano D.O.P. Whole Peeled Tomatoes 2.5kg",
      category: "Packaged Goods",
      supplierCode: "SUP-SIC-03",
      storageCondition: "AMBIENT" as const,
      shelfLifeDays: 730,
      originCountry: "Italy",
      allergenInfo: null,
      skuCode: "SKU-TOM-013",
      barcode: "8001234560133",
      packSize: "6 x 2.5 kg Cans Case",
      grossWeightKg: new Prisma.Decimal("16.500"),
      netWeightKg: new Prisma.Decimal("15.000"),
      unitPrice: new Prisma.Decimal("4.20"),
      landedCost: new Prisma.Decimal("2.50"),
      uomCode: "KG",
    },
    // Frozen Specialties
    {
      code: "PRD-FROZEN-PORCINI",
      name: "Frozen Whole Porcini Mushrooms IQF (Boletus)",
      category: "Frozen Food",
      supplierCode: "SUP-LOM-02",
      storageCondition: "FROZEN" as const,
      shelfLifeDays: 360,
      originCountry: "Italy",
      allergenInfo: null,
      skuCode: "SKU-PORC-014",
      barcode: "8001234560140",
      packSize: "5 x 1 kg Bag Carton",
      grossWeightKg: new Prisma.Decimal("5.300"),
      netWeightKg: new Prisma.Decimal("5.000"),
      unitPrice: new Prisma.Decimal("24.00"),
      landedCost: new Prisma.Decimal("17.50"),
      uomCode: "KG",
    },
    {
      code: "PRD-BERRIES-IQF",
      name: "Organic Wild Mixed Forest Berries IQF",
      category: "Frozen Food",
      supplierCode: "SUP-LOM-02",
      storageCondition: "FROZEN" as const,
      shelfLifeDays: 540,
      originCountry: "Italy",
      allergenInfo: null,
      skuCode: "SKU-BERR-015",
      barcode: "8001234560157",
      packSize: "4 x 2.5 kg Box",
      grossWeightKg: new Prisma.Decimal("10.500"),
      netWeightKg: new Prisma.Decimal("10.000"),
      unitPrice: new Prisma.Decimal("8.90"),
      landedCost: new Prisma.Decimal("5.60"),
      uomCode: "KG",
    },
    // Fresh Produce (Supplier: Sud Terre)
    {
      code: "PRD-BASIL-GENOVESE",
      name: "Fresh Hydroponic Genovese Basil DOP",
      category: "Produce",
      supplierCode: "SUP-SIC-03",
      storageCondition: "CHILLED" as const,
      shelfLifeDays: 8,
      originCountry: "Italy",
      allergenInfo: null,
      skuCode: "SKU-BAS-016",
      barcode: "8001234560164",
      packSize: "1 kg Polystyrene Box",
      grossWeightKg: new Prisma.Decimal("1.200"),
      netWeightKg: new Prisma.Decimal("1.000"),
      unitPrice: new Prisma.Decimal("12.50"),
      landedCost: new Prisma.Decimal("7.80"),
      uomCode: "KG",
    },
    {
      code: "PRD-ROCKET-BABY",
      name: "Organic Baby Wild Arugula 1kg Box",
      category: "Produce",
      supplierCode: "SUP-SIC-03",
      storageCondition: "CHILLED" as const,
      shelfLifeDays: 9,
      originCountry: "Italy",
      allergenInfo: null,
      skuCode: "SKU-ARUG-017",
      barcode: "8001234560171",
      packSize: "1 kg Box",
      grossWeightKg: new Prisma.Decimal("1.150"),
      netWeightKg: new Prisma.Decimal("1.000"),
      unitPrice: new Prisma.Decimal("8.50"),
      landedCost: new Prisma.Decimal("4.80"),
      uomCode: "KG",
    },
    // Grains & Milling (Ambient)
    {
      code: "PRD-FLOUR-TIPO-00",
      name: "Neapolitan Pizza Flour Caputo Tipo 00 25kg",
      category: "Grains & Milling",
      supplierCode: "SUP-SIC-03",
      storageCondition: "AMBIENT" as const,
      shelfLifeDays: 365,
      originCountry: "Italy",
      allergenInfo: "Gluten",
      skuCode: "SKU-FLOUR-018",
      barcode: "8001234560188",
      packSize: "25 kg Sack",
      grossWeightKg: new Prisma.Decimal("25.200"),
      netWeightKg: new Prisma.Decimal("25.000"),
      unitPrice: new Prisma.Decimal("1.35"),
      landedCost: new Prisma.Decimal("0.85"),
      uomCode: "KG",
    },
    {
      code: "PRD-CARNAROLI-RICE",
      name: "Aged Carnaroli Rice Gran Riserva 5kg",
      category: "Grains & Milling",
      supplierCode: "SUP-LOM-02",
      storageCondition: "AMBIENT" as const,
      shelfLifeDays: 730,
      originCountry: "Italy",
      allergenInfo: null,
      skuCode: "SKU-RICE-019",
      barcode: "8001234560195",
      packSize: "5 kg Vacuum Cloth Bag",
      grossWeightKg: new Prisma.Decimal("5.100"),
      netWeightKg: new Prisma.Decimal("5.000"),
      unitPrice: new Prisma.Decimal("4.50"),
      landedCost: new Prisma.Decimal("2.90"),
      uomCode: "KG",
    },
    // Beverages & Wine (Ambient)
    {
      code: "PRD-SPARKLING-FRANCI",
      name: "Franciacorta DOCG Brut Millesimato 750ml",
      category: "Beverages",
      supplierCode: "SUP-LOM-02",
      storageCondition: "AMBIENT" as const,
      shelfLifeDays: 1095,
      originCountry: "Italy",
      allergenInfo: "Sulphites",
      skuCode: "SKU-WINE-020",
      barcode: "8001234560201",
      packSize: "6 x 750ml Case",
      grossWeightKg: new Prisma.Decimal("8.500"),
      netWeightKg: new Prisma.Decimal("4.500"),
      unitPrice: new Prisma.Decimal("26.00"),
      landedCost: new Prisma.Decimal("18.50"),
      uomCode: "EACH",
    },
  ];

  const products: Record<string, string> = {};
  const skus: Record<string, string> = {};

  for (const p of productsData) {
    const prodRecord = await prisma.product.upsert({
      where: { code: p.code },
      update: { name: p.name, category: p.category },
      create: {
        code: p.code,
        name: p.name,
        category: p.category,
        supplierId: suppliers[p.supplierCode],
        storageCondition: p.storageCondition,
        shelfLifeDays: p.shelfLifeDays,
        originCountry: p.originCountry,
        allergenInfo: p.allergenInfo,
      },
    });
    products[p.code] = prodRecord.id;

    const skuRecord = await prisma.sKU.upsert({
      where: { code: p.skuCode },
      update: { unitPrice: p.unitPrice, landedCost: p.landedCost },
      create: {
        code: p.skuCode,
        productId: prodRecord.id,
        uomId: uoms[p.uomCode],
        barcode: p.barcode,
        packSize: p.packSize,
        grossWeightKg: p.grossWeightKg,
        netWeightKg: p.netWeightKg,
        unitPrice: p.unitPrice,
        landedCost: p.landedCost,
      },
    });
    skus[p.skuCode] = skuRecord.id;
  }

  // --------------------------------------------------------------------------
  // 7. Customers (Exactly 10 Customers)
  // --------------------------------------------------------------------------
  console.log("-> Seeding Customers (10 Customers)...");

  const customersData = [
    {
      code: "CUST-MIL-001",
      name: "Ristorante Da Giacomo Milano",
      legalName: "Giacomo Milano S.r.l.",
      customerType: "RESTAURANT" as const,
      vatNumber: "IT04567890123",
      sdiRecipientCode: "M5UXCR1",
      email: "chef@giacomomilano.it",
      phone: "+39 02 7602 3456",
      deliveryAddress: "Via Pasquale Sottocorno 6",
      city: "Milan",
      postalCode: "20129",
      creditLimit: new Prisma.Decimal("25000.00"),
      paymentTerms: "Net 30",
    },
    {
      code: "CUST-MIL-002",
      name: "Trattoria Trippa Navigli",
      legalName: "Trippa Gastronomia S.r.l.",
      customerType: "RESTAURANT" as const,
      vatNumber: "IT05678901234",
      sdiRecipientCode: "SUBM70N",
      email: "ordini@trippamilano.it",
      phone: "+39 02 3674 1234",
      deliveryAddress: "Via Giorgio Vasari 1",
      city: "Milan",
      postalCode: "20135",
      creditLimit: new Prisma.Decimal("18000.00"),
      paymentTerms: "Net 30",
    },
    {
      code: "CUST-MIL-003",
      name: "BioBurger Gourmet Duomo",
      legalName: "BioBurger Italia S.p.A.",
      customerType: "FRANCHISE_STORE" as const,
      vatNumber: "IT06789012345",
      sdiRecipientCode: "USAL8PV",
      email: "store.duomo@bioburger.it",
      phone: "+39 02 8765 4321",
      deliveryAddress: "Via Torino 22",
      city: "Milan",
      postalCode: "20123",
      creditLimit: new Prisma.Decimal("15000.00"),
      paymentTerms: "Net 14",
    },
    {
      code: "CUST-MIL-004",
      name: "Luigi's Neapolitan Pizzeria Brera",
      legalName: "Pizzeria Brera S.n.c.",
      customerType: "RESTAURANT" as const,
      vatNumber: "IT07890123456",
      sdiRecipientCode: "W7YVJK9",
      email: "forno@pizzeriabrera.it",
      phone: "+39 02 8051 2345",
      deliveryAddress: "Via Fiori Chiari 15",
      city: "Milan",
      postalCode: "20121",
      creditLimit: new Prisma.Decimal("12000.00"),
      paymentTerms: "Net 30",
    },
    {
      code: "CUST-MON-005",
      name: "Grand Hotel Villa Reale Monza",
      legalName: "Monza Hospitality Group S.p.A.",
      customerType: "HOTEL_CATERING" as const,
      vatNumber: "IT08901234567",
      sdiRecipientCode: "BA6ET11",
      email: "kitchen@villarealemonza.it",
      phone: "+39 039 394 1234",
      deliveryAddress: "Viale Brianza 1",
      city: "Monza",
      postalCode: "20900",
      creditLimit: new Prisma.Decimal("40000.00"),
      paymentTerms: "Net 60",
    },
    {
      code: "CUST-BER-006",
      name: "Alimentari & Gastronomia Orobica",
      legalName: "Orobica Food Retail S.r.l.",
      customerType: "RETAIL" as const,
      vatNumber: "IT09012345678",
      sdiRecipientCode: "KRRH6B9",
      email: "acquisti@orobicafood.it",
      phone: "+39 035 241234",
      deliveryAddress: "Via Sentierone 18",
      city: "Bergamo",
      postalCode: "24121",
      creditLimit: new Prisma.Decimal("10000.00"),
      paymentTerms: "Net 30",
    },
    {
      code: "CUST-BRE-007",
      name: "Brescia Food Service SpA",
      legalName: "Brescia Food Service S.p.A.",
      customerType: "WHOLESALE" as const,
      vatNumber: "IT01239874561",
      sdiRecipientCode: "A4707H7",
      email: "direzione@bresciafoodservice.it",
      phone: "+39 030 351234",
      deliveryAddress: "Via Triumplina 150",
      city: "Brescia",
      postalCode: "25123",
      creditLimit: new Prisma.Decimal("60000.00"),
      paymentTerms: "Net 60",
    },
    {
      code: "CUST-VER-008",
      name: "Osteria Alle Testiere Verona",
      legalName: "Testiere Ristorazione S.r.l.",
      customerType: "RESTAURANT" as const,
      vatNumber: "IT02345678902",
      sdiRecipientCode: "SUBM70N",
      email: "prenotazioni@alletestiereverona.it",
      phone: "+39 045 800 1234",
      deliveryAddress: "Corso Porta Nuova 34",
      city: "Verona",
      postalCode: "37122",
      creditLimit: new Prisma.Decimal("20000.00"),
      paymentTerms: "Net 30",
    },
    {
      code: "CUST-GAR-009",
      name: "Lake Garda Resort & Spa",
      legalName: "Sirmione Lake Resorts S.p.A.",
      customerType: "HOTEL_CATERING" as const,
      vatNumber: "IT03456789013",
      sdiRecipientCode: "M5UXCR1",
      email: "fb.manager@gardaresort.it",
      phone: "+39 030 916 1234",
      deliveryAddress: "Piazza Castello 5",
      city: "Sirmione",
      postalCode: "25019",
      creditLimit: new Prisma.Decimal("35000.00"),
      paymentTerms: "Net 45",
    },
    {
      code: "CUST-COM-010",
      name: "Ristorante Bellagio Panoramico",
      legalName: "Bellagio Lake Dining S.r.l.",
      customerType: "RESTAURANT" as const,
      vatNumber: "IT04561237894",
      sdiRecipientCode: "W7YVJK9",
      email: "info@bellagiopanoramico.it",
      phone: "+39 031 950 1234",
      deliveryAddress: "Salita Serbelloni 12",
      city: "Bellagio",
      postalCode: "22021",
      creditLimit: new Prisma.Decimal("22000.00"),
      paymentTerms: "Net 30",
    },
  ];

  const customers: Record<string, string> = {};
  for (const c of customersData) {
    const record = await prisma.customer.upsert({
      where: { code: c.code },
      update: { name: c.name, creditLimit: c.creditLimit },
      create: c,
    });
    customers[c.code] = record.id;
  }

  // --------------------------------------------------------------------------
  // 8. Lots & Opening Stock Balances (FEFO Traceability)
  // --------------------------------------------------------------------------
  console.log("-> Seeding Lots & Opening Stock Balances...");

  const now = new Date();
  const day = 86400000;

  const lotsData = [
    {
      lotNumber: "LOT-2026-SAL-001",
      productCode: "PRD-SALMON-NOR",
      skuCode: "SKU-SAL-001",
      supplierLotNumber: "NF-2026-B981",
      productionDate: new Date(now.getTime() - 2 * day),
      expiryDate: new Date(now.getTime() + 12 * day), // Expires in 12 days
      initialQuantity: new Prisma.Decimal("120.000"),
      warehouseCode: "WH-MIL-01",
      binCode: "BIN-MIL-CH-A01",
      quantity: new Prisma.Decimal("100.000"),
      reserved: new Prisma.Decimal("20.000"),
      available: new Prisma.Decimal("80.000"),
    },
    {
      lotNumber: "LOT-2026-COD-002",
      productCode: "PRD-COD-LOIN",
      skuCode: "SKU-COD-002",
      supplierLotNumber: "NF-2026-C441",
      productionDate: new Date(now.getTime() - 30 * day),
      expiryDate: new Date(now.getTime() + 330 * day), // Frozen long shelf life
      initialQuantity: new Prisma.Decimal("300.000"),
      warehouseCode: "WH-MIL-01",
      binCode: "BIN-MIL-FR-B01",
      quantity: new Prisma.Decimal("250.000"),
      reserved: new Prisma.Decimal("30.000"),
      available: new Prisma.Decimal("220.000"),
    },
    {
      lotNumber: "LOT-2026-PARM-003",
      productCode: "PRD-PARMIGIANO-24",
      skuCode: "SKU-PARM-003",
      supplierLotNumber: "LM-2026-P012",
      productionDate: new Date(now.getTime() - 60 * day),
      expiryDate: new Date(now.getTime() + 120 * day),
      initialQuantity: new Prisma.Decimal("80.000"),
      warehouseCode: "WH-MIL-01",
      binCode: "BIN-MIL-CH-A02",
      quantity: new Prisma.Decimal("75.000"),
      reserved: new Prisma.Decimal("10.000"),
      available: new Prisma.Decimal("65.000"),
    },
    {
      lotNumber: "LOT-2026-MOZZ-004",
      productCode: "PRD-MOZZ-BUFALA",
      skuCode: "SKU-MOZZ-004",
      supplierLotNumber: "LM-2026-M883",
      productionDate: new Date(now.getTime() - 1 * day),
      expiryDate: new Date(now.getTime() + 18 * day),
      initialQuantity: new Prisma.Decimal("60.000"),
      warehouseCode: "WH-VER-02",
      binCode: "BIN-VER-CH-A01",
      quantity: new Prisma.Decimal("50.000"),
      reserved: new Prisma.Decimal("0.000"),
      available: new Prisma.Decimal("50.000"),
    },
    {
      lotNumber: "LOT-2026-SPAG-005",
      productCode: "PRD-PASTA-GRAGNANO",
      skuCode: "SKU-SPAG-010",
      supplierLotNumber: "ST-2026-G101",
      productionDate: new Date(now.getTime() - 40 * day),
      expiryDate: new Date(now.getTime() + 690 * day),
      initialQuantity: new Prisma.Decimal("500.000"),
      warehouseCode: "WH-MIL-01",
      binCode: "BIN-MIL-AM-C01",
      quantity: new Prisma.Decimal("450.000"),
      reserved: new Prisma.Decimal("50.000"),
      available: new Prisma.Decimal("400.000"),
    },
    {
      lotNumber: "LOT-2026-OIL-006",
      productCode: "PRD-OLIVE-OIL-EVO",
      skuCode: "SKU-OIL-011",
      supplierLotNumber: "ST-2026-EV99",
      productionDate: new Date(now.getTime() - 20 * day),
      expiryDate: new Date(now.getTime() + 520 * day),
      initialQuantity: new Prisma.Decimal("200.000"),
      warehouseCode: "WH-VER-02",
      binCode: "BIN-VER-AM-C01",
      quantity: new Prisma.Decimal("180.000"),
      reserved: new Prisma.Decimal("20.000"),
      available: new Prisma.Decimal("160.000"),
    },
  ];

  const lots: Record<string, string> = {};

  for (const l of lotsData) {
    const lotRecord = await prisma.lot.upsert({
      where: { lotNumber: l.lotNumber },
      update: { expiryDate: l.expiryDate, status: "RELEASED" },
      create: {
        lotNumber: l.lotNumber,
        productId: products[l.productCode],
        skuId: skus[l.skuCode],
        supplierLotNumber: l.supplierLotNumber,
        productionDate: l.productionDate,
        expiryDate: l.expiryDate,
        initialQuantity: l.initialQuantity,
        status: "RELEASED",
      },
    });
    lots[l.lotNumber] = lotRecord.id;

    await prisma.stock.upsert({
      where: {
        binId_skuId_lotId: {
          binId: bins[l.binCode],
          skuId: skus[l.skuCode],
          lotId: lotRecord.id,
        },
      },
      update: {
        quantity: l.quantity,
        reservedQuantity: l.reserved,
        availableQuantity: l.available,
      },
      create: {
        warehouseId: warehouses[l.warehouseCode],
        binId: bins[l.binCode],
        skuId: skus[l.skuCode],
        lotId: lotRecord.id,
        quantity: l.quantity,
        reservedQuantity: l.reserved,
        availableQuantity: l.available,
        lastCountedAt: new Date(),
      },
    });
  }

  // --------------------------------------------------------------------------
  // 9. Sample Purchase Orders, ASNs & Quality Checks
  // --------------------------------------------------------------------------
  console.log("-> Seeding Purchase Orders, ASNs & Quality Checks...");

  const po = await prisma.purchaseOrder.upsert({
    where: { poNumber: "PO-2026-0001" },
    update: { totalAmount: new Prisma.Decimal("2640.00") },
    create: {
      poNumber: "PO-2026-0001",
      supplierId: suppliers["SUP-NOR-01"],
      orderDate: new Date(now.getTime() - 7 * day),
      expectedDate: new Date(now.getTime() - 2 * day),
      subtotal: new Prisma.Decimal("2400.00"),
      taxAmount: new Prisma.Decimal("240.00"),
      totalAmount: new Prisma.Decimal("2640.00"),
      status: "COMPLETED",
      notes: "Weekly fresh Atlantic salmon intake for Milan Hub",
    },
  });

  const asn = await prisma.aSN.upsert({
    where: { asnNumber: "ASN-2026-0001" },
    update: { status: "INSPECTED" },
    create: {
      asnNumber: "ASN-2026-0001",
      purchaseOrderId: po.id,
      supplierId: suppliers["SUP-NOR-01"],
      carrierName: "Nordic Cold Chain Express",
      trackingNumber: "TRK-NOR-892144",
      shippedAt: new Date(now.getTime() - 4 * day),
      expectedArrivalAt: new Date(now.getTime() - 2 * day),
      driverName: "Sven Lindholm",
      vehiclePlate: "BS 491 NF",
      declaredTempC: new Prisma.Decimal("1.8"),
      status: "INSPECTED",
    },
  });

  const qc = await prisma.qualityCheck.upsert({
    where: { checkNumber: "QC-2026-0001" },
    update: { outcome: "PASSED" },
    create: {
      checkNumber: "QC-2026-0001",
      asnId: asn.id,
      inspectedById: users["marco.bellini@ascentra.com"],
      temperatureReadingC: new Prisma.Decimal("2.1"),
      packagingConditionOk: true,
      labelingCompliant: true,
      sampleSizeCases: 5,
      defectCount: 0,
      outcome: "PASSED",
      correctiveNotes: "Intact ice-slurry packaging; core salmon temperature verified at 2.1°C.",
    },
  });

  // --------------------------------------------------------------------------
  // 10. Sample Customer Orders, Order Lines, Invoices & Payments
  // --------------------------------------------------------------------------
  console.log("-> Seeding Customer Orders, Invoices & Payments...");

  const order1 = await prisma.order.upsert({
    where: { orderNumber: "SO-2026-0001" },
    update: { totalAmount: new Prisma.Decimal("604.50") },
    create: {
      orderNumber: "SO-2026-0001",
      customerId: customers["CUST-MIL-001"],
      createdById: users["elena.conti@ascentra.com"],
      orderDate: new Date(now.getTime() - 3 * day),
      deliveryDate: new Date(now.getTime() + 1 * day),
      channel: "B2B_PORTAL",
      subtotal: new Prisma.Decimal("550.00"),
      taxAmount: new Prisma.Decimal("54.50"),
      totalAmount: new Prisma.Decimal("604.50"),
      status: "CONFIRMED",
      creditApproved: true,
      notes: "Early morning delivery required before 08:30 AM",
    },
  });

  // Order Line with FEFO lot reservation
  await prisma.orderLine.create({
    data: {
      orderId: order1.id,
      skuId: skus["SKU-SAL-001"],
      lotId: lots["LOT-2026-SAL-001"],
      quantity: new Prisma.Decimal("20.000"),
      unitPrice: new Prisma.Decimal("18.90"),
      totalPrice: new Prisma.Decimal("378.00"),
      status: "ALLOCATED",
    },
  });

  // Invoice with partial payment demonstrating relational payment reconciliation
  const invoice1 = await prisma.invoice.upsert({
    where: { invoiceNumber: "INV-2026-0001" },
    update: { totalAmount: new Prisma.Decimal("604.50"), paidAmount: new Prisma.Decimal("300.00"), balanceDue: new Prisma.Decimal("304.50") },
    create: {
      invoiceNumber: "INV-2026-0001",
      orderId: order1.id,
      customerId: customers["CUST-MIL-001"],
      issueDate: new Date(now.getTime() - 2 * day),
      dueDate: new Date(now.getTime() + 28 * day),
      subtotal: new Prisma.Decimal("550.00"),
      taxAmount: new Prisma.Decimal("54.50"),
      totalAmount: new Prisma.Decimal("604.50"),
      paidAmount: new Prisma.Decimal("300.00"),
      balanceDue: new Prisma.Decimal("304.50"),
      status: "PARTIALLY_PAID",
      sdiTransmissionStatus: "ACCEPTED",
      sdiReference: "SDI-2026-IT-9821447",
    },
  });

  await prisma.payment.upsert({
    where: { paymentNumber: "PAY-2026-0001" },
    update: { amount: new Prisma.Decimal("300.00") },
    create: {
      paymentNumber: "PAY-2026-0001",
      invoiceId: invoice1.id,
      amount: new Prisma.Decimal("300.00"),
      paymentDate: new Date(now.getTime() - 1 * day),
      paymentMethod: "SEPA_INSTANT",
      reference: "CRO-89219472911",
      status: "COMPLETED",
      notes: "Advance partial transfer received via SEPA Instant",
    },
  });

  // --------------------------------------------------------------------------
  // 11. Cold Chain Temperature Logs
  // --------------------------------------------------------------------------
  console.log("-> Seeding Temperature Logs...");

  await prisma.temperatureLog.createMany({
    data: [
      {
        sensorId: "SENS-MIL-CH01",
        readingC: new Prisma.Decimal("2.3"),
        minAllowedC: new Prisma.Decimal("0.5"),
        maxAllowedC: new Prisma.Decimal("4.0"),
        status: "IN_RANGE",
        warehouseId: warehouses["WH-MIL-01"],
        zoneId: zones["Z-MIL-CHILL-01"],
        binId: bins["BIN-MIL-CH-A01"],
        recordedById: users["marco.bellini@ascentra.com"],
        notes: "Automated hourly IoT telemetry sample",
      },
      {
        sensorId: "SENS-MIL-FR01",
        readingC: new Prisma.Decimal("-20.8"),
        minAllowedC: new Prisma.Decimal("-24.0"),
        maxAllowedC: new Prisma.Decimal("-18.0"),
        status: "IN_RANGE",
        warehouseId: warehouses["WH-MIL-01"],
        zoneId: zones["Z-MIL-FROZ-01"],
        binId: bins["BIN-MIL-FR-B01"],
        recordedById: users["marco.bellini@ascentra.com"],
        notes: "Sub-zero deep freeze cycle nominal",
      },
    ],
  });

  // --------------------------------------------------------------------------
  // 12. Audit Events & AI Action Logs
  // --------------------------------------------------------------------------
  console.log("-> Seeding Audit Events & Governed AI Action Logs...");

  await prisma.auditEvent.create({
    data: {
      actorId: users["elena.conti@ascentra.com"],
      actorEmail: "elena.conti@ascentra.com",
      action: "order.created",
      entityType: "Order",
      entityId: order1.id,
      summary: "Sales order SO-2026-0001 created for customer Ristorante Da Giacomo Milano (€604.50)",
      ipAddress: "127.0.0.1",
      userAgent: "Ascentra-ERP-App/1.0",
      newValues: { orderNumber: "SO-2026-0001", totalAmount: "604.50", channel: "B2B_PORTAL" },
    },
  });

  await prisma.aIActionLog.create({
    data: {
      actionType: "FEFO_ALLOCATION_OPTIMIZATION",
      modelName: "gemini-2.5-flash",
      promptSummary: "Evaluate best lot for SO-2026-0001 salmon demand prioritizing shortest expiry",
      proposedAction: {
        recommendedLot: "LOT-2026-SAL-001",
        daysToExpiry: 12,
        reason: "Earliest expiry lot with sufficient quantity in Milan Chilled Bin A01",
      },
      confidenceScore: new Prisma.Decimal("0.9750"),
      approvalStatus: "APPROVED",
      approvedById: users["elena.conti@ascentra.com"],
      affectedEntityType: "Order",
      affectedEntityId: order1.id,
    },
  });

  // --------------------------------------------------------------------------
  // 13. Food Safety: Recalls & CAPA
  // --------------------------------------------------------------------------
  console.log("-> Seeding Recall & CAPA Simulations...");

  const recall = await prisma.recall.upsert({
    where: { recallNumber: "REC-2026-001" },
    update: { status: "COMPLETED" },
    create: {
      recallNumber: "REC-2026-001",
      title: "Simulated Mock Traceability Recall - Supplier Cold Chain Integrity Drill",
      reason: "Annual mock recall exercise testing rapid customer containment under IFS Food v8 standard",
      hazardClassification: "CLASS_III_LOW_RISK",
      regulatoryAgency: "EFSA Internal Quality Drill",
      status: "COMPLETED",
      summaryReport: "100% of affected lots quarantined in 42 minutes; customer notifications simulated successfully.",
    },
  });

  await prisma.recallLot.upsert({
    where: {
      recallId_lotId: {
        recallId: recall.id,
        lotId: lots["LOT-2026-PARM-003"],
      },
    },
    update: {},
    create: {
      recallId: recall.id,
      lotId: lots["LOT-2026-PARM-003"],
      quarantinedKg: new Prisma.Decimal("10.000"),
      recoveredKg: new Prisma.Decimal("10.000"),
      disposition: "drill_released",
    },
  });

  await prisma.cAPA.upsert({
    where: { capaNumber: "CAPA-2026-001" },
    update: { status: "VERIFIED" },
    create: {
      capaNumber: "CAPA-2026-001",
      title: "Dock 1 Inbound Temperature Logging Procedure Calibration",
      description: "Inspection probe SENS-MIL-CH01 exhibited 0.4°C variance during quarterly calibration",
      rootCause: "Thermal sensor probe calibration drift after 180 continuous operating days",
      correctiveAction: "Probe recalibrated with ice point standard and secondary laser thermometer verification",
      preventiveAction: "Reduced calibration inspection interval from 180 to 90 days; alert notification added",
      severity: "MEDIUM",
      status: "VERIFIED",
      ownerId: users["marco.bellini@ascentra.com"],
      qualityCheckId: qc.id,
      recallId: recall.id,
      targetDueDate: new Date(now.getTime() + 15 * day),
      completedDate: new Date(now.getTime() - 1 * day),
      verificationNotes: "Calibration confirmed within ±0.1°C variance by Quality Manager.",
    },
  });

  console.log("✅ Ascentra ERP Database Seed Completed Successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
