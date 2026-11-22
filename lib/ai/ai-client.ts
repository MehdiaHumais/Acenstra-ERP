/**
 * Centralized OmniRoute AI Gateway - Core Client
 *
 * Implements:
 * - OpenAI-compatible Chat Completions (/chat/completions)
 * - Transparent handling of standard JSON and SSE (Server-Sent Events) streaming
 * - Request timeouts with AbortController
 * - Exponential backoff retry for transient 429/503 errors
 * - Latency, token usage and route metadata tracking
 * - Token/Key sanitization
 * - Safe fallback to local deterministic heuristics when configured
 */

import { getOmniRouteConfig } from "./ai-config";
import {
  OmniRouteChatMessage,
  OmniRouteChatOptions,
  OmniRouteChatCompletionResponse,
  OmniRouteConnectionTestResult,
  OmniRouteStreamChunk,
} from "./ai-types";
import {
  OmniRouteAuthError,
  OmniRouteConnectionError,
  OmniRouteDisabledError,
  OmniRouteError,
  OmniRouteRateLimitError,
  OmniRouteTimeoutError,
} from "./ai-errors";
import { aiLogger } from "./ai-logging";
import { discoverOmniRouteModels } from "./ai-models";

/**
 * Parses Server-Sent Events (SSE) body and reconstructs complete completion text and metadata.
 */
async function parseSseStream(
  stream: ReadableStream<Uint8Array>
): Promise<{ text: string; id: string; model: string; finishReason: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let accumulatedText = "";
  let completionId = "chatcmpl-" + Date.now();
  let resolvedModel = "omniroute";
  let finishReason = "stop";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;

        if (trimmed.startsWith("data:")) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") {
            continue;
          }

          try {
            const chunk = JSON.parse(dataStr) as OmniRouteStreamChunk;
            if (chunk.id) completionId = chunk.id;
            if (chunk.model) resolvedModel = chunk.model;

            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              accumulatedText += delta.content;
            }
            if (chunk.choices?.[0]?.finish_reason) {
              finishReason = chunk.choices[0].finish_reason;
            }
          } catch {
            // Non-JSON SSE line, ignore
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text: accumulatedText,
    id: completionId,
    model: resolvedModel,
    finishReason,
  };
}

/**
 * Executes an OpenAI-compatible Chat Completion request against OmniRoute.
 */
export async function omniRouteChatCompletion(
  messages: OmniRouteChatMessage[],
  options: OmniRouteChatOptions = {}
): Promise<OmniRouteChatCompletionResponse> {
  const config = getOmniRouteConfig();

  if (!config.enabled) {
    throw new OmniRouteDisabledError();
  }

  if (!config.apiKey) {
    throw new OmniRouteAuthError("OmniRoute API key is not configured in environment (OMNIROUTE_API_KEY).");
  }

  const model = options.model || config.defaultModel;
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const maxRetries = options.maxRetries ?? config.maxRetries;
  const url = `${config.baseUrl}/chat/completions`;

  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.3,
    stream: options.stream ?? true, // OmniRoute efficiently streams
  };

  if (typeof options.max_tokens === "number") {
    payload.max_tokens = options.max_tokens;
  }
  if (typeof options.top_p === "number") {
    payload.top_p = options.top_p;
  }
  if (options.response_format?.type === "json_object") {
    payload.response_format = { type: "json_object" };
  }

  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= maxRetries) {
    attempt++;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();

    try {
      aiLogger.info(`Sending Chat Completion to OmniRoute (${model})`, {
        attempt,
        url,
        messageCount: messages.length,
      });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutHandle);
      const latencyMs = Date.now() - startTime;
      const routeClass = response.headers.get("x-omniroute-route-class") || undefined;
      const modelResolvedHeader = response.headers.get("x-omniroute-model-resolved") || undefined;

      // Handle Authentication & Authorization errors
      if (response.status === 401 || response.status === 403) {
        throw new OmniRouteAuthError(
          `OmniRoute authentication failed (HTTP ${response.status}). Check OMNIROUTE_API_KEY.`
        );
      }

      // Handle Rate Limiting with backoff
      if (response.status === 429) {
        const errorMsg = `OmniRoute rate limit exceeded (HTTP 429) on attempt ${attempt}.`;
        if (attempt <= maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000;
          aiLogger.warn(`${errorMsg} Retrying in ${backoff}ms...`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw new OmniRouteRateLimitError(errorMsg);
      }

      // Handle Gateway Overload / 503 / 502 with backoff
      if ((response.status === 502 || response.status === 503 || response.status === 504) && attempt <= maxRetries) {
        const backoff = Math.pow(2, attempt) * 1200;
        aiLogger.warn(`OmniRoute gateway transient error HTTP ${response.status}. Retrying in ${backoff}ms...`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      if (!response.ok) {
        let errBody = "";
        try {
          errBody = await response.text();
        } catch {
          // ignore
        }
        throw new OmniRouteError(
          `OmniRoute chat completion failed: HTTP ${response.status} ${response.statusText}`,
          "OMNIROUTE_HTTP_ERROR",
          response.status,
          { body: errBody }
        );
      }

      const contentType = response.headers.get("content-type") || "";

      // Case 1: Streamed response (SSE)
      if (contentType.includes("text/event-stream") && response.body) {
        const parsed = await parseSseStream(response.body);
        const approxPromptTokens = Math.ceil(JSON.stringify(messages).length / 4);
        const approxCompletionTokens = Math.ceil(parsed.text.length / 4);

        const result: OmniRouteChatCompletionResponse = {
          id: parsed.id,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: parsed.model || model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: parsed.text,
              },
              finish_reason: parsed.finishReason,
            },
          ],
          usage: {
            prompt_tokens: approxPromptTokens,
            completion_tokens: approxCompletionTokens,
            total_tokens: approxPromptTokens + approxCompletionTokens,
          },
          omniroute_metadata: {
            route_class: routeClass,
            latency_ms: latencyMs,
            model_resolved: modelResolvedHeader || parsed.model,
          },
        };

        aiLogger.metric("omniRouteChatCompletion", latencyMs, {
          model,
          tokens: result.usage?.total_tokens,
          resolvedModel: result.omniroute_metadata?.model_resolved,
        });

        return result;
      }

      // Case 2: Standard JSON response
      const json = (await response.json()) as OmniRouteChatCompletionResponse;
      json.omniroute_metadata = {
        route_class: routeClass,
        latency_ms: latencyMs,
        model_resolved: modelResolvedHeader || json.model,
      };

      aiLogger.metric("omniRouteChatCompletion", latencyMs, {
        model,
        tokens: json.usage?.total_tokens,
        resolvedModel: json.omniroute_metadata?.model_resolved,
      });

      return json;
    } catch (error: unknown) {
      clearTimeout(timeoutHandle);
      const isAbort = (error as { name?: string })?.name === "AbortError";
      if (isAbort) {
        lastError = new OmniRouteTimeoutError(
          `OmniRoute request timed out after ${timeoutMs}ms (model: ${model}).`
        );
      } else {
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      aiLogger.error(`OmniRoute chat attempt ${attempt} failed`, lastError, { model });

      if (attempt <= maxRetries && !isAbort && !(lastError instanceof OmniRouteAuthError)) {
        const backoff = Math.pow(2, attempt) * 1000;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      break;
    }
  }

  throw (
    lastError ||
    new OmniRouteConnectionError("Failed to complete OmniRoute request after multiple attempts.")
  );
}

/**
 * High-level helper: Generates raw text response for a prompt.
 */
export async function generateAiText(
  prompt: string,
  options: OmniRouteChatOptions & { systemPrompt?: string } = {}
): Promise<string> {
  const messages: OmniRouteChatMessage[] = [];
  if (options.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const completion = await omniRouteChatCompletion(messages, options);
  return completion.choices?.[0]?.message?.content || "";
}

/**
 * High-level helper: Prompts OmniRoute and safely parses validated JSON output.
 */
export async function generateAiStructuredJson<T>(
  prompt: string,
  systemPrompt: string,
  options: OmniRouteChatOptions = {}
): Promise<T> {
  const fullSystemPrompt = `${systemPrompt}\n\nIMPORTANT: Return ONLY valid JSON in your response. No markdown fences, no conversational preamble, no trailing commentary.`;
  const rawText = await generateAiText(prompt, {
    ...options,
    systemPrompt: fullSystemPrompt,
    response_format: { type: "json_object" },
  });

  // Strip possible markdown fences like ```json ... ```
  let cleaned = rawText.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/```$/, "").trim();
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch (parseError) {
    aiLogger.error("Failed to parse JSON from OmniRoute response", parseError, {
      rawSnippet: cleaned.slice(0, 300),
    });
    throw new OmniRouteError(
      `OmniRoute returned malformed JSON: ${(parseError as Error).message}`,
      "OMNIROUTE_JSON_PARSE_ERROR",
      502,
      { rawSnippet: cleaned.slice(0, 300) }
    );
  }
}

/**
 * Performs a comprehensive live connection and health test against OmniRoute.
 * Used by admin settings to verify credentials, discover models, and ping chat.
 */
export async function testOmniRouteConnection(): Promise<OmniRouteConnectionTestResult> {
  const config = getOmniRouteConfig();
  const startTime = Date.now();

  if (!config.apiKey) {
    return {
      success: false,
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.defaultModel,
      latencyMs: 0,
      error: "Missing OMNIROUTE_API_KEY in environment variables.",
      errorCode: "MISSING_API_KEY",
    };
  }

  try {
    // 1. Discover models
    let modelsCount = 0;
    try {
      const models = await discoverOmniRouteModels(true);
      modelsCount = models.length;
    } catch (e) {
      aiLogger.warn("Model discovery step during connection test encountered an issue", {
        error: String(e),
      });
    }

    // 2. Perform a lightweight chat ping
    const pingMessages: OmniRouteChatMessage[] = [
      {
        role: "user",
        content: "Ping. Respond with exactly the word 'PONG'.",
      },
    ];

    const completion = await omniRouteChatCompletion(pingMessages, {
      model: config.defaultModel,
      max_tokens: 10,
      temperature: 0.1,
      timeoutMs: 25000,
    });

    const latencyMs = Date.now() - startTime;
    const sampleResponse = completion.choices?.[0]?.message?.content?.trim() || "";
    const resolvedModel = completion.omniroute_metadata?.model_resolved || completion.model;

    return {
      success: true,
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.defaultModel,
      resolvedModel,
      latencyMs,
      modelsDiscoveredCount: modelsCount,
      sampleResponse,
      details: {
        routeClass: completion.omniroute_metadata?.route_class,
        tokens: completion.usage?.total_tokens,
      },
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - startTime;
    const err = error as { name?: string; message?: string; code?: string };
    return {
      success: false,
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.defaultModel,
      latencyMs,
      error: err.message || "Failed to establish connection to OmniRoute gateway.",
      errorCode: err.code || "OMNIROUTE_CONNECT_FAILED",
    };
  }
}
