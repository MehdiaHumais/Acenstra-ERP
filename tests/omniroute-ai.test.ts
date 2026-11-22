/**
 * Test Suite: OmniRoute Centralized AI Gateway for Ascentra ERP
 * Tests configuration, credential masking, error hierarchy, logging sanitization,
 * and live gateway connectivity.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Load .env into process.env if present
try {
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
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {
  // ignore
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
  OmniRouteAuthError,
  OmniRouteTimeoutError,
  OmniRouteModelUnavailableError,
} from "../lib/ai";

test("OmniRoute Config: loads expected environment defaults and masks keys", () => {
  const config = getOmniRouteConfig();
  assert.equal(config.provider, "omniroute");
  assert.equal(config.baseUrl, "http://77.237.239.69:20128/v1");
  assert.equal(config.defaultModel, "auto/best-chat");
  assert.ok(config.apiKey.startsWith("sk-"), "API key should start with sk-");

  // Masking
  const masked = maskApiKey(config.apiKey);
  assert.ok(masked.startsWith("sk-468"));
  assert.ok(masked.endsWith("4a7a"));
  assert.ok(!masked.includes("5d5d-b71042"), "Middle secret bytes must be redacted");

  // Sanitized config for admin UI
  const sanitized = getSanitizedOmniRouteConfig();
  assert.equal(sanitized.hasApiKey, true);
  assert.equal(sanitized.maskedApiKey, masked);
  assert.equal((sanitized as any).apiKey, undefined, "Raw apiKey must not be present in sanitized output");
});

test("OmniRoute Logging: redacts bearer tokens and sk- keys in nested objects", () => {
  const dirty = {
    apiKey: "sk-468dd6854ea35d5d-b71042-d8eb4a7a",
    authHeader: "Bearer sk-468dd6854ea35d5d-b71042-d8eb4a7a",
    payload: {
      password: "secretpassword123",
      user: "executive_admin",
    },
  };

  const clean = sanitizeLogValue(dirty) as any;
  assert.ok(clean.apiKey.includes("..."));
  assert.ok(!clean.apiKey.includes("5d5d"));
  assert.equal(clean.payload.password, "[REDACTED]");
  assert.equal(clean.payload.user, "executive_admin");
});

test("OmniRoute Error Hierarchy: status codes and codes match specifications", () => {
  const authErr = new OmniRouteAuthError();
  assert.equal(authErr.status, 401);
  assert.equal(authErr.code, "OMNIROUTE_AUTH_ERROR");

  const timeoutErr = new OmniRouteTimeoutError();
  assert.equal(timeoutErr.status, 504);
  assert.equal(timeoutErr.code, "OMNIROUTE_TIMEOUT_ERROR");

  const modelErr = new OmniRouteModelUnavailableError("nonexistent/model");
  assert.equal(modelErr.status, 404);
  assert.equal(modelErr.code, "OMNIROUTE_MODEL_UNAVAILABLE");
  assert.equal(modelErr.requestedModel, "nonexistent/model");
});

test("OmniRoute Models: known auto-router aliases are recognized", async () => {
  assert.ok(KNOWN_MODEL_ALIASES.length >= 4);
  const hasBestChat = KNOWN_MODEL_ALIASES.some((m) => m.alias === "auto/best-chat");
  assert.ok(hasBestChat, "auto/best-chat must be registered in catalog");

  const available = await isModelAvailable("auto/best-chat");
  assert.equal(available, true);
});

test("OmniRoute Live Gateway: connection test against live endpoint", async () => {
  const result = await testOmniRouteConnection();
  console.log("Live OmniRoute test result:", JSON.stringify(result, null, 2));

  assert.equal(result.provider, "omniroute");
  assert.equal(result.baseUrl, "http://77.237.239.69:20128/v1");
  assert.ok(result.latencyMs > 0, "Latency must be positive");
  assert.equal(result.success, true, `Gateway connection failed: ${result.error}`);
  assert.ok(result.sampleResponse && result.sampleResponse.length > 0, "Must receive sample response");
});
