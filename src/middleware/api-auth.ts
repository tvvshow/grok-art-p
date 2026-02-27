import type { Context, Next, MiddlewareHandler } from "hono";
import type { Env } from "../env";
import { validateApiKey, type ApiKeyInfo } from "../repo/api-keys";

/**
 * Extended environment type with API key context variables
 */
export type ApiAuthEnv = {
  Bindings: Env;
  Variables: {
    apiKeyInfo: ApiKeyInfo;
  };
};

/**
 * OpenAI-compatible error response format
 */
interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

/**
 * Create an OpenAI-compatible error response
 */
function createErrorResponse(
  c: Context<ApiAuthEnv>,
  status: number,
  message: string,
  type: string,
  code: string
): Response {
  const error: OpenAIErrorResponse = {
    error: {
      message,
      type,
      code,
    },
  };
  return c.json(error, status as 400 | 401 | 403 | 429 | 500);
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== "bearer") {
    return null;
  }

  return parts[1] || null;
}

/**
 * API Key authentication middleware for Hono
 *
 * Supports two authentication styles:
 * - OpenAI:    Authorization: Bearer <api_key>
 * - Anthropic: x-api-key: <api_key>
 */
export const apiAuthMiddleware: MiddlewareHandler<ApiAuthEnv> = async (
  c,
  next
): Promise<Response | void> => {
  // x-api-key (Anthropic style) takes priority, then Authorization Bearer (OpenAI style)
  const token =
    c.req.header("x-api-key") ||
    extractBearerToken(c.req.header("Authorization"));

  if (!token) {
    return createErrorResponse(
      c,
      401,
      "Missing or invalid Authorization header. Expected format: Bearer <api_key>",
      "authentication_error",
      "missing_api_key"
    );
  }

  // Validate API key against database
  const keyInfo = await validateApiKey(c.env.DB, token);

  if (!keyInfo) {
    return createErrorResponse(
      c,
      401,
      "Invalid API key",
      "authentication_error",
      "invalid_api_key"
    );
  }

  // Check if API key is enabled
  if (!keyInfo.enabled) {
    return createErrorResponse(
      c,
      403,
      "API key is disabled",
      "authentication_error",
      "api_key_disabled"
    );
  }

  // Check rate limit
  if (keyInfo.rate_limit > 0 && keyInfo.daily_usage >= keyInfo.rate_limit) {
    return createErrorResponse(
      c,
      429,
      "Rate limit exceeded. Please try again later.",
      "rate_limit_error",
      "rate_limit_exceeded"
    );
  }

  // Store API key info in context for downstream handlers
  c.set("apiKeyInfo", keyInfo);

  // Continue to next handler
  return next();
};

// Re-export ApiKeyInfo type for convenience
export type { ApiKeyInfo };
