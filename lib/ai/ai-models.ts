/**
 * Centralized OmniRoute AI Gateway - Model Aliases & Discovery Service
 * Fetches available models from /v1/models and verifies model availability.
 */

import { getOmniRouteConfig } from "./ai-config";
import { OmniRouteModelInfo, OmniRouteModelListResponse, OmniRouteModelAlias } from "./ai-types";
import { OmniRouteAuthError, OmniRouteConnectionError, OmniRouteTimeoutError } from "./ai-errors";
import { aiLogger } from "./ai-logging";

export interface OmniRouteModelCatalogEntry {
  alias: OmniRouteModelAlias;
  label: string;
  description: string;
  bestFor: string;
  isAutoRouter: boolean;
}

export const KNOWN_MODEL_ALIASES: OmniRouteModelCatalogEntry[] = [
  {
    alias: "GLM-5" as OmniRouteModelAlias,
    label: "GLM-5 (Zhipu)",
    description: "Zhipu AI GLM-5 — replacement for the retired glm-4.7.",
    bestFor: "General ERP assistance, chat, analysis.",
    isAutoRouter: false,
  },
  {
    alias: "auto/best-chat",
    label: "Auto / Best Chat (Default)",
    description: "OmniRoute dynamic smart router targeting optimal instruct/chat models.",
    bestFor: "General ERP assistance, operational summaries, user interaction.",
    isAutoRouter: true,
  },
  {
    alias: "auto/best-fast",
    label: "Auto / Best Fast",
    description: "Low-latency routing prioritizing quick response times and lightweight throughput.",
    bestFor: "Real-time sanity checks, instant categorization, automated labeling.",
    isAutoRouter: true,
  },
  {
    alias: "auto/best-reasoning",
    label: "Auto / Best Reasoning",
    description: "Routes to high-capacity chain-of-thought and analytical reasoning models.",
    bestFor: "Demand forecasting, complex anomaly detection, root-cause recall analysis.",
    isAutoRouter: true,
  },
  {
    alias: "auto/chat",
    label: "Auto / Chat",
    description: "General conversational routing alias.",
    bestFor: "Standard ERP chat flows.",
    isAutoRouter: true,
  },
  {
    alias: "auto/fast",
    label: "Auto / Fast",
    description: "Fast routing tier for batch processing and high-frequency tasks.",
    bestFor: "Background evaluation, bulk validation.",
    isAutoRouter: true,
  },
  {
    alias: "auto/cheap",
    label: "Auto / Cost-Optimized",
    description: "Lowest token cost model routing.",
    bestFor: "Non-critical internal audits, background indexing.",
    isAutoRouter: true,
  },
];

let cachedModels: OmniRouteModelInfo[] = [];
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Discovers available models from the OmniRoute gateway endpoint (/v1/models).
 * Cached in-memory for 5 minutes.
 */
export async function discoverOmniRouteModels(forceRefresh = false): Promise<OmniRouteModelInfo[]> {
  const now = Date.now();
  if (!forceRefresh && cachedModels.length > 0 && now < cacheExpiresAt) {
    return cachedModels;
  }

  const config = getOmniRouteConfig();
  if (!config.apiKey) {
    aiLogger.warn("Cannot discover OmniRoute models: missing API key");
    return [];
  }

  const url = `${config.baseUrl}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout for model catalog

  try {
    const startTime = Date.now();
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.status === 401 || response.status === 403) {
      throw new OmniRouteAuthError("OmniRoute model discovery rejected: invalid API key.");
    }

    if (!response.ok) {
      throw new OmniRouteConnectionError(
        `OmniRoute models endpoint returned HTTP ${response.status} ${response.statusText}`
      );
    }

    const payload = (await response.json()) as OmniRouteModelListResponse;
    const models = Array.isArray(payload.data) ? payload.data : [];
    cachedModels = models;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;

    aiLogger.metric("discoverOmniRouteModels", Date.now() - startTime, {
      count: models.length,
      sample: models.slice(0, 3).map((m) => m.id),
    });

    return models;
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (error instanceof OmniRouteAuthError || error instanceof OmniRouteConnectionError) {
      throw error;
    }
    const err = error as { name?: string; message?: string };
    if (err.name === "AbortError") {
      throw new OmniRouteTimeoutError("Timed out while fetching OmniRoute model catalog (20s).");
    }
    throw new OmniRouteConnectionError(
      `Failed to reach OmniRoute models endpoint: ${err.message || String(error)}`
    );
  }
}

/**
 * Validates if the requested model alias exists or is supported.
 * Since auto/* aliases are virtual routing choices managed dynamically by OmniRoute,
 * we consider all KNOWN_MODEL_ALIASES valid, plus any discovered raw IDs.
 */
export async function isModelAvailable(modelAlias: string): Promise<boolean> {
  if (KNOWN_MODEL_ALIASES.some((entry) => entry.alias === modelAlias)) {
    return true;
  }
  try {
    const models = await discoverOmniRouteModels();
    return models.some((m) => m.id.toLowerCase() === modelAlias.toLowerCase());
  } catch {
    // If model catalog lookup fails, allow known auto aliases
    return modelAlias.startsWith("auto/");
  }
}
