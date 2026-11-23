/**
 * Centralized OmniRoute AI Gateway - Configuration Provider
 * Reads environment variables, validates configuration, and provides sanitized views for admin UI.
 */

import { OmniRouteGatewayConfig, OmniRouteModelAlias, AiProviderType } from "./ai-types";

const DEFAULT_BASE_URL = "http://77.237.239.69:20128/v1";
const DEFAULT_MODEL: OmniRouteModelAlias = "GLM-5" as OmniRouteModelAlias;
// Keep AI calls responsive: a slow/unreachable gateway must hand control back
// to the local grounded fallback quickly instead of blocking the request for
// over a minute across multiple timed-out retries.
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_CIRCUIT_COOLDOWN_MS = 30000;

/**
 * Task-specific model alias overrides mapping.
 */
export const DEFAULT_TASK_ALIASES: Record<string, OmniRouteModelAlias> = {
  chat: "GLM-5" as OmniRouteModelAlias,
  fast: "auto/best-fast",
  reasoning: "auto/best-reasoning",
  forecasting: "auto/best-reasoning",
  anomaly_detection: "auto/best-reasoning",
  replenishment: "GLM-5" as OmniRouteModelAlias,
  executive_insights: "GLM-5" as OmniRouteModelAlias,
  traceability_recall: "GLM-5" as OmniRouteModelAlias,
  quality_checks: "auto/best-fast",
};

/**
 * Masks an API key for safe logging and UI display.
 * E.g. "sk-468dd6854ea35d5d-b71042-d8eb4a7a" -> "sk-468...4a7a"
 */
export function maskApiKey(apiKey: string | undefined | null): string {
  if (!apiKey || typeof apiKey !== "string") return "(not configured)";
  const trimmed = apiKey.trim();
  if (trimmed.length <= 10) return "********";
  const start = trimmed.slice(0, 6);
  const end = trimmed.slice(-4);
  return `${start}...${end}`;
}

/** Parses a non-negative env integer; unlike `||`, this honors an explicit 0. */
function parseNonNegativeInt(value: string | undefined, fallback: number, allowZero = false): number {
  const parsed = parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= (allowZero ? 0 : 1) ? parsed : fallback;
}

/**
 * Retrieves the live OmniRoute server-side configuration from process.env.
 */
export function getOmniRouteConfig(): OmniRouteGatewayConfig {
  const provider = (process.env.AI_PROVIDER || "omniroute").toLowerCase() as AiProviderType;
  const baseUrl = (process.env.OMNIROUTE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = (process.env.OMNIROUTE_API_KEY || "").trim();
  const defaultModel = (process.env.OMNIROUTE_MODEL || DEFAULT_MODEL) as OmniRouteModelAlias;
  const timeoutMs = parseNonNegativeInt(process.env.OMNIROUTE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const maxRetries = parseNonNegativeInt(process.env.OMNIROUTE_MAX_RETRIES, DEFAULT_MAX_RETRIES, true);
  const circuitCooldownMs = parseNonNegativeInt(
    process.env.OMNIROUTE_CIRCUIT_COOLDOWN_MS,
    DEFAULT_CIRCUIT_COOLDOWN_MS
  );
  const enabled = process.env.OMNIROUTE_ENABLED !== "false" && process.env.AI_ENABLED !== "false";

  // Parse any task-specific overrides from env e.g. OMNIROUTE_TASK_REASONING_MODEL
  const taskAliases: Record<string, OmniRouteModelAlias> = {
    ...DEFAULT_TASK_ALIASES,
  };

  if (process.env.OMNIROUTE_MODEL_FAST) taskAliases.fast = process.env.OMNIROUTE_MODEL_FAST as OmniRouteModelAlias;
  if (process.env.OMNIROUTE_MODEL_REASONING) taskAliases.reasoning = process.env.OMNIROUTE_MODEL_REASONING as OmniRouteModelAlias;

  return {
    provider,
    baseUrl,
    apiKey,
    defaultModel,
    taskAliases,
    enabled,
    timeoutMs,
    maxRetries,
    circuitCooldownMs,
  };
}

/**
 * Returns a sanitized configuration safe to pass to frontend admin components.
 * Masks the API key and omits secret internal credentials.
 */
export function getSanitizedOmniRouteConfig() {
  const config = getOmniRouteConfig();
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    defaultModel: config.defaultModel,
    taskAliases: config.taskAliases,
    enabled: config.enabled,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    hasApiKey: Boolean(config.apiKey && config.apiKey.length > 5),
    maskedApiKey: maskApiKey(config.apiKey),
  };
}
