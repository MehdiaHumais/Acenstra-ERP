/**
 * Centralized OmniRoute AI Gateway - Type Definitions
 * Compatible with OpenAI Chat Completions API specification.
 */

export type OmniRouteModelAlias =
  | "auto/best-chat"
  | "auto/best-fast"
  | "auto/chat"
  | "auto/fast"
  | "auto/cheap"
  | "auto/best-reasoning"
  | (string & {});

export type AiProviderType = "omniroute" | "statistical_local" | "gemini";

export interface OmniRouteChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface OmniRouteChatOptions {
  model?: OmniRouteModelAlias;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  response_format?: { type: "json_object" | "text" };
  fallbackToLocal?: boolean;
}

export interface OmniRouteUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OmniRouteChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: "stop" | "length" | "content_filter" | "tool_calls" | string | null;
}

export interface OmniRouteChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OmniRouteChoice[];
  usage?: OmniRouteUsage;
  system_fingerprint?: string | null;
  omniroute_metadata?: {
    route_class?: string;
    request_id?: string;
    latency_ms?: number;
    provider?: string;
    model_resolved?: string;
    cache_hit?: boolean;
  };
}

export interface OmniRouteStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
    };
    finish_reason: string | null;
  }>;
}

export interface OmniRouteModelInfo {
  id: string;
  object: "model";
  created?: number;
  owned_by?: string;
  capabilities?: {
    tool_calling?: boolean;
    reasoning?: boolean;
    thinking?: boolean;
    vision?: boolean;
  };
  context_length?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
}

export interface OmniRouteModelListResponse {
  object: "list";
  data: OmniRouteModelInfo[];
}

export interface OmniRouteGatewayConfig {
  provider: AiProviderType;
  baseUrl: string;
  apiKey: string;
  defaultModel: OmniRouteModelAlias;
  taskAliases: Record<string, OmniRouteModelAlias>;
  enabled: boolean;
  timeoutMs: number;
  maxRetries: number;
}

export interface OmniRouteConnectionTestResult {
  success: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  latencyMs: number;
  modelsDiscoveredCount?: number;
  sampleResponse?: string;
  resolvedModel?: string;
  error?: string;
  errorCode?: string;
  details?: Record<string, unknown>;
}
