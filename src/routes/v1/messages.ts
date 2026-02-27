/**
 * Anthropic Messages API compatible endpoint
 * POST /v1/messages
 *
 * Allows Claude Code CLI and other Anthropic-compatible clients to use this proxy.
 * Translates Anthropic request/response format ↔ Grok API.
 */

import { Hono } from "hono";
import { streamChat } from "../../grok/chat";
import { getRandomToken } from "../../repo/tokens";
import { incrementApiKeyUsage } from "../../repo/api-keys";
import type { ApiAuthEnv } from "../../middleware/api-auth";

const app = new Hono<ApiAuthEnv>();

const MAX_RETRIES = 5;

// ---------------------------------------------------------------------------
// Model mapping: Anthropic model names → Grok model IDs
// ---------------------------------------------------------------------------
function mapModel(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes("opus"))   return "grok-4-heavy";
  if (lower.includes("haiku"))  return "grok-4-fast";
  if (lower.includes("sonnet")) return "grok-4";
  if (lower.startsWith("claude")) return "grok-4"; // unknown Claude → default
  return model; // native Grok model names pass through
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------
type AnthropicContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: string; url?: string; data?: string; media_type?: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown };

type AnthropicContent = string | AnthropicContentPart[];

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContent;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
}

type OAIContent =
  | string
  | Array<{ type: string; text?: string; image_url?: { url: string } }>;

interface OAIMessage {
  role: string;
  content: OAIContent;
}

// ---------------------------------------------------------------------------
// Format conversion: Anthropic → OpenAI-compatible (what streamChat expects)
// ---------------------------------------------------------------------------
function convertContentPart(
  part: AnthropicContentPart
): { type: string; text?: string; image_url?: { url: string } } | null {
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "image") {
    const src = part.source;
    if (src.url) return { type: "image_url", image_url: { url: src.url } };
    if (src.data && src.media_type) {
      return { type: "image_url", image_url: { url: `data:${src.media_type};base64,${src.data}` } };
    }
  }
  // tool_use / tool_result - convert to text summary
  if (part.type === "tool_use") return { type: "text", text: `[Tool: ${part.name}]` };
  if (part.type === "tool_result") return { type: "text", text: `[Tool result]` };
  return null;
}

function convertContent(content: AnthropicContent): OAIContent {
  if (typeof content === "string") return content;

  const parts = content
    .map(convertContentPart)
    .filter((p): p is NonNullable<typeof p> => p !== null);

  // Simplify to string if only one text part
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text || "";
  return parts;
}

function convertMessages(messages: AnthropicMessage[], system?: string): OAIMessage[] {
  const result: OAIMessage[] = [];
  if (system) result.push({ role: "system", content: system });
  for (const msg of messages) {
    result.push({ role: msg.role, content: convertContent(msg.content) });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Anthropic SSE event builders
// ---------------------------------------------------------------------------
function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function evtMessageStart(msgId: string, model: string): string {
  return sseEvent("message_start", {
    type: "message_start",
    message: {
      id: msgId,
      type: "message",
      role: "assistant",
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });
}

function evtContentBlockStart(): string {
  return sseEvent("content_block_start", {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
}

function evtPing(): string {
  return sseEvent("ping", { type: "ping" });
}

function evtDelta(text: string): string {
  return sseEvent("content_block_delta", {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text },
  });
}

function evtContentBlockStop(): string {
  return sseEvent("content_block_stop", { type: "content_block_stop", index: 0 });
}

function evtMessageDelta(outputTokens: number): string {
  return sseEvent("message_delta", {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
}

function evtMessageStop(): string {
  return sseEvent("message_stop", { type: "message_stop" });
}

// ---------------------------------------------------------------------------
// POST /v1/messages
// ---------------------------------------------------------------------------
app.post("/", async (c) => {
  let body: AnthropicRequest;
  try {
    body = await c.req.json<AnthropicRequest>();
  } catch {
    return Response.json({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON body" } }, { status: 400 });
  }

  const { model: rawModel, messages, system, stream = false } = body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return Response.json({ type: "error", error: { type: "invalid_request_error", message: "messages is required and must be a non-empty array" } }, { status: 400 });
  }

  const grokModel = mapModel(rawModel);
  const convertedMessages = convertMessages(messages, system);

  const reqUrl = new URL(c.req.url);
  const baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;
  const posterPreview = c.env.VIDEO_POSTER_PREVIEW === "true";

  const db = c.env.DB;
  const excludedTokenIds: string[] = [];
  let retryCount = 0;
  const msgId = `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

  // ── Streaming ──────────────────────────────────────────────────────────────
  if (stream) {
    const streamBody = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const push = (s: string) => controller.enqueue(enc.encode(s));

        push(evtMessageStart(msgId, rawModel));
        push(evtContentBlockStart());
        push(evtPing());

        let success = false;
        let charCount = 0;

        while (retryCount < MAX_RETRIES) {
          const token = await getRandomToken(db, excludedTokenIds);
          if (!token) {
            const errMsg = excludedTokenIds.length > 0 ? "All tokens rate limited" : "No available tokens";
            push(evtDelta(`[Error: ${errMsg}]`));
            break;
          }

          let tokenDone = false;
          try {
            for await (const update of streamChat(
              token.sso, token.sso_rw, convertedMessages, grokModel,
              true, token.id, baseUrl, posterPreview
            )) {
              if (update.type === "error") {
                const msg = update.message || "";
                if (msg.includes("429") || msg.includes("rate") || msg.includes("401")) {
                  excludedTokenIds.push(token.id);
                  retryCount++;
                  break;
                }
                push(evtDelta(`[Error: ${msg}]`));
                tokenDone = true;
                break;
              }
              if (update.type === "token" && update.content) {
                charCount += update.content.length;
                push(evtDelta(update.content));
              }
              if (update.type === "done") {
                success = true;
                tokenDone = true;
                break;
              }
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            if (message.includes("429") || message.includes("rate")) {
              excludedTokenIds.push(token.id);
              retryCount++;
              continue;
            }
            push(evtDelta(`[Error: ${message}]`));
            tokenDone = true;
          }

          if (success || tokenDone) break;
        }

        push(evtContentBlockStop());
        push(evtMessageDelta(Math.ceil(charCount / 4)));
        push(evtMessageStop());

        if (success) {
          const apiKeyInfo = c.get("apiKeyInfo");
          if (apiKeyInfo) await incrementApiKeyUsage(c.env.DB, apiKeyInfo.id);
        }

        controller.close();
      },
    });

    return new Response(streamBody, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // ── Non-streaming ──────────────────────────────────────────────────────────
  let fullContent = "";
  let success = false;
  let lastError = "";

  while (retryCount < MAX_RETRIES) {
    const token = await getRandomToken(db, excludedTokenIds);
    if (!token) {
      const msg = excludedTokenIds.length > 0
        ? `All tokens rate limited (tried ${excludedTokenIds.length})`
        : "No available tokens";
      return Response.json({ type: "error", error: { type: "overloaded_error", message: msg } }, { status: 529 });
    }

    try {
      for await (const update of streamChat(
        token.sso, token.sso_rw, convertedMessages, grokModel,
        true, token.id, baseUrl, posterPreview
      )) {
        if (update.type === "error") {
          const msg = update.message || "";
          if (msg.includes("429") || msg.includes("rate") || msg.includes("401")) {
            excludedTokenIds.push(token.id);
            retryCount++;
            lastError = msg;
            break;
          }
          return Response.json({ type: "error", error: { type: "api_error", message: msg } }, { status: 500 });
        }
        if (update.type === "token" && update.content) fullContent += update.content;
        if (update.type === "done") { success = true; break; }
      }
      if (success) break;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("429") || message.includes("rate")) {
        excludedTokenIds.push(token.id);
        retryCount++;
        lastError = message;
        continue;
      }
      return Response.json({ type: "error", error: { type: "api_error", message } }, { status: 500 });
    }
  }

  if (!success) {
    return Response.json(
      { type: "error", error: { type: "overloaded_error", message: lastError || "Failed after retries" } },
      { status: 529 }
    );
  }

  const apiKeyInfo = c.get("apiKeyInfo");
  if (apiKeyInfo) await incrementApiKeyUsage(c.env.DB, apiKeyInfo.id);

  return c.json({
    id: msgId,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: fullContent }],
    model: rawModel,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: Math.ceil(fullContent.length / 4),
    },
  });
});

export { app as messagesRoutes };
