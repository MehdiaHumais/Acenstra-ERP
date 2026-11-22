// @ts-nocheck
import fs from "node:fs";
import path from "node:path";

// Load .env
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

import {
  getOmniRouteConfig,
  getSanitizedOmniRouteConfig,
  maskApiKey,
  sanitizeLogValue,
  KNOWN_MODEL_ALIASES,
  isModelAvailable,
  omniRouteChatCompletion,
  testOmniRouteConnection,
} from "../lib/ai";

async function main() {
  console.log("=== STEP 1: CONFIGURATION VERIFICATION ===");
  const config = getOmniRouteConfig();
  console.log("Provider:", config.provider);
  console.log("Base URL:", config.baseUrl);
  console.log("Default Model:", config.defaultModel);
  console.log("Masked API Key:", maskApiKey(config.apiKey));
  console.log("Enabled:", config.enabled);

  console.log("\n=== STEP 2: SANITIZED ADMIN CONFIG ===");
  const sanitized = getSanitizedOmniRouteConfig();
  console.log("Admin View:", JSON.stringify(sanitized, null, 2));

  console.log("\n=== STEP 3: LOG REDACTION CHECK ===");
  const sampleLog = {
    apiKey: config.apiKey,
    authorization: `Bearer ${config.apiKey}`,
    password: "supersecretpassword",
    normalData: "Ascentra Food ERP",
  };
  console.log("Sanitized Log Output:", JSON.stringify(sanitizeLogValue(sampleLog), null, 2));

  console.log("\n=== STEP 4: KNOWN MODEL ALIASES ===");
  console.log(`Registered ${KNOWN_MODEL_ALIASES.length} known aliases:`);
  for (const a of KNOWN_MODEL_ALIASES) {
    console.log(` - ${a.alias}: ${a.label} (${a.bestFor})`);
  }

  console.log("\n=== STEP 5: LIVE OMNIROUTE GATEWAY TEST ===");
  console.log("Pinging OmniRoute at", config.baseUrl, "...");
  const testResult = await testOmniRouteConnection();
  console.log("Live Test Result:\n", JSON.stringify(testResult, null, 2));

  if (!testResult.success) {
    console.error("GATEWAY TEST FAILED:", testResult.error);
    process.exit(1);
  }

  console.log("\n=== ALL OMNIROUTE CHECKS COMPLETED SUCCESSFULLY ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
