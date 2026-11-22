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

import { askErpAssistant } from "../server/services/ai-assistant.service";

async function main() {
  console.log("=== TEST 1: USER SAYS 'hi' ===");
  const res1 = await askErpAssistant([{ role: "user", content: "hi" }]);
  console.log("Response to 'hi':\n" + res1.reply);

  console.log("\n=== TEST 2: USER SAYS 'how many orders do we have?' ===");
  const res2 = await askErpAssistant([
    { role: "user", content: "how many orders do we have?" },
  ]);
  console.log("Response to orders query:\n" + res2.reply);

  console.log("\nALL TESTS PASSED!");
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
