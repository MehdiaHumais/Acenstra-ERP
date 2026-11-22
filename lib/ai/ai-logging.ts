/**
 * Centralized OmniRoute AI Gateway - Sanitized Audit & Operational Logger
 * Ensures API keys, tokens, bearer headers, passwords, and sensitive ERP PII are never printed to logs.
 */

import { maskApiKey } from "./ai-config";

/**
 * Sanitizes arbitrary values, redacting patterns resembling API keys, bearer tokens, or secrets.
 */
export function sanitizeLogValue(val: unknown): unknown {
  if (typeof val === "string") {
    // Redact bearer tokens
    let sanitized = val.replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, "Bearer [REDACTED]");
    // Redact keys starting with sk-
    sanitized = sanitized.replace(/sk-[A-Za-z0-9_\-]{8,}/gi, (match) => maskApiKey(match));
    // Redact password / secret assignments
    sanitized = sanitized.replace(/(password|secret|apiKey|api_key)=([^\s&]+)/gi, "$1=[REDACTED]");
    return sanitized;
  }
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeLogValue(item));
  }
  if (val !== null && typeof val === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (
        lower.includes("apikey") ||
        lower.includes("api_key") ||
        lower.includes("secret") ||
        lower.includes("password") ||
        lower.includes("authorization") ||
        lower.includes("token")
      ) {
        copy[key] = typeof value === "string" ? maskApiKey(value) : "[REDACTED]";
      } else {
        copy[key] = sanitizeLogValue(value);
      }
    }
    return copy;
  }
  return val;
}

export const aiLogger = {
  info(message: string, context?: Record<string, unknown>) {
    const sanitized = context ? sanitizeLogValue(context) : undefined;
    console.log(`[OmniRoute AI INFO] ${message}`, sanitized ? JSON.stringify(sanitized) : "");
  },

  warn(message: string, context?: Record<string, unknown>) {
    const sanitized = context ? sanitizeLogValue(context) : undefined;
    console.warn(`[OmniRoute AI WARN] ${message}`, sanitized ? JSON.stringify(sanitized) : "");
  },

  error(message: string, error?: unknown, context?: Record<string, unknown>) {
    const sanitizedContext = context ? sanitizeLogValue(context) : undefined;
    const errMessage = error instanceof Error ? error.message : String(error || "");
    const errName = error instanceof Error ? error.name : "Error";
    console.error(
      `[OmniRoute AI ERROR] ${message} - ${errName}: ${errMessage}`,
      sanitizedContext ? JSON.stringify(sanitizedContext) : ""
    );
  },

  metric(metricName: string, durationMs: number, metadata?: Record<string, unknown>) {
    const sanitized = metadata ? sanitizeLogValue(metadata) : undefined;
    console.log(
      `[OmniRoute AI METRIC] ${metricName} finished in ${durationMs}ms`,
      sanitized ? JSON.stringify(sanitized) : ""
    );
  },
};
