/**
 * Centralized OmniRoute AI Gateway - Error Hierarchy
 */

export class OmniRouteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, code = "OMNIROUTE_ERROR", status = 500, details?: unknown) {
    super(message);
    this.name = "OmniRouteError";
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OmniRouteAuthError extends OmniRouteError {
  constructor(message = "OmniRoute API authentication failed. Verify OMNIROUTE_API_KEY.", details?: unknown) {
    super(message, "OMNIROUTE_AUTH_ERROR", 401, details);
    this.name = "OmniRouteAuthError";
  }
}

export class OmniRouteConnectionError extends OmniRouteError {
  constructor(message = "Unable to connect to OmniRoute gateway.", details?: unknown) {
    super(message, "OMNIROUTE_CONNECTION_ERROR", 503, details);
    this.name = "OmniRouteConnectionError";
  }
}

export class OmniRouteTimeoutError extends OmniRouteError {
  constructor(message = "OmniRoute request timed out.", details?: unknown) {
    super(message, "OMNIROUTE_TIMEOUT_ERROR", 504, details);
    this.name = "OmniRouteTimeoutError";
  }
}

export class OmniRouteRateLimitError extends OmniRouteError {
  constructor(message = "OmniRoute rate limit exceeded.", details?: unknown) {
    super(message, "OMNIROUTE_RATE_LIMIT", 429, details);
    this.name = "OmniRouteRateLimitError";
  }
}

export class OmniRouteModelUnavailableError extends OmniRouteError {
  readonly requestedModel: string;

  constructor(requestedModel: string, message?: string, details?: unknown) {
    super(
      message || `OmniRoute model alias '${requestedModel}' is unavailable or not registered in gateway catalog.`,
      "OMNIROUTE_MODEL_UNAVAILABLE",
      404,
      details
    );
    this.name = "OmniRouteModelUnavailableError";
    this.requestedModel = requestedModel;
  }
}

export class OmniRouteDisabledError extends OmniRouteError {
  constructor(message = "OmniRoute AI gateway is currently disabled in system settings.") {
    super(message, "OMNIROUTE_DISABLED", 503);
    this.name = "OmniRouteDisabledError";
  }
}
