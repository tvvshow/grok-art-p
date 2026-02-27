/**
 * Grok Image Edit Service - Upload image + Chat API based image-to-image generation
 *
 * Flow:
 * 1. Upload user image to https://grok.com/rest/app-chat/upload-file
 * 2. Use chat API with toolOverrides + modelConfigOverride for image editing
 * 3. Parse streaming response for generated image URLs
 *
 * Reference: github.com/chenyme/grok2api
 */

import { getHeaders, buildCookie } from "./headers";

const UPLOAD_API = "https://grok.com/rest/app-chat/upload-file";
const CHAT_API = "https://grok.com/rest/app-chat/conversations/new";

export interface ImageEditUpdate {
  type: "progress" | "image" | "error" | "done";
  message?: string;
  url?: string;
  index?: number;
  progress?: number;
}

interface UploadResult {
  fileMetadataId: string;
  fileUri: string;
}

/**
 * Upload an image to Grok's upload-file API
 * Accepts base64 content (without data URI prefix)
 */
export async function uploadImage(
  sso: string,
  ssoRw: string,
  fileName: string,
  fileMimeType: string,
  base64Content: string
): Promise<UploadResult> {
  const cookie = buildCookie(sso, ssoRw);
  const headers = getHeaders(cookie);

  const response = await fetch(UPLOAD_API, {
    method: "POST",
    headers,
    body: JSON.stringify({
      fileName,
      fileMimeType,
      content: base64Content,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Upload failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const result = (await response.json()) as UploadResult;
  if (!result.fileMetadataId && !result.fileUri) {
    throw new Error("Upload returned empty result");
  }

  return result;
}

/**
 * Recursively collect image URLs from response object.
 * Looks for keys: generatedImageUrls, imageUrls, imageURLs
 * (matches grok2api _collect_images behavior)
 */
function collectImages(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];

  const urls: string[] = [];
  const targetKeys = new Set(["generatedImageUrls", "imageUrls", "imageURLs"]);

  if (Array.isArray(obj)) {
    for (const item of obj) {
      urls.push(...collectImages(item));
    }
    return urls;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const val = record[key];
    if (targetKeys.has(key) && Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string" && item.startsWith("http")) {
          urls.push(item);
        }
      }
    } else if (val && typeof val === "object") {
      urls.push(...collectImages(val));
    }
  }

  // Deduplicate
  return [...new Set(urls)];
}

/**
 * Stream image edit via Grok chat API
 * Uses modelConfigOverride to reference uploaded images for editing
 */
export async function* streamImageEdit(
  sso: string,
  ssoRw: string,
  prompt: string,
  imageUrls: string[],
  imageCount: number = 2
): AsyncGenerator<ImageEditUpdate> {
  const cookie = buildCookie(sso, ssoRw);
  const headers = getHeaders(cookie);

  // Payload structure matches grok2api AppChatReverse.build_payload()
  const modelConfigOverride = {
    modelMap: {
      imageEditModel: "imagine",
      imageEditModelConfig: {
        imageReferences: imageUrls,
      },
    },
  };

  const payload: Record<string, unknown> = {
    temporary: true,
    modelName: "grok-3",
    modelMode: null,
    message: prompt || "Generate new variations based on this image",
    fileAttachments: [],
    imageAttachments: [],
    disableSearch: false,
    enableImageGeneration: true,
    returnImageBytes: false,
    returnRawGrokInXaiRequest: false,
    enableImageStreaming: true,
    imageGenerationCount: imageCount,
    forceConcise: false,
    toolOverrides: { imageGen: true },
    enableSideBySide: true,
    sendFinalMetadata: true,
    isReasoning: false,
    disableTextFollowUps: false,
    disableMemory: true,
    forceSideBySide: false,
    isAsyncChat: false,
    disableSelfHarmShortCircuit: false,
    deviceEnvInfo: {
      darkModeEnabled: false,
      devicePixelRatio: 2,
      screenWidth: 2056,
      screenHeight: 1329,
      viewportWidth: 2056,
      viewportHeight: 1083,
    },
    responseMetadata: {
      requestModelDetails: { modelId: "grok-3" },
      modelConfigOverride,
    },
  };

  let response: Response;
  try {
    response = await fetch(CHAT_API, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (e) {
    yield { type: "error", message: `Network error: ${e instanceof Error ? e.message : String(e)}` };
    return;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const status = response.status;
    if (status === 429) {
      yield { type: "error", message: "Rate limited (429)" };
    } else {
      yield { type: "error", message: `HTTP ${status}: ${text.slice(0, 300)}` };
    }
    return;
  }

  if (!response.body) {
    yield { type: "error", message: "No response body" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const collectedUrls: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line);
          const resp = data?.result?.response;
          if (!resp) continue;

          // Image generation progress
          const imgProgress = resp.streamingImageGenerationResponse;
          if (imgProgress) {
            const progress = imgProgress.progress || 0;
            const imageIndex = imgProgress.imageIndex || 0;
            yield {
              type: "progress",
              index: imageIndex,
              progress,
            };
            continue;
          }

          // Final modelResponse - recursively collect image URLs
          const modelResponse = resp.modelResponse;
          if (modelResponse) {
            const urls = collectImages(modelResponse);
            for (const url of urls) {
              if (!collectedUrls.includes(url)) {
                collectedUrls.push(url);
                yield {
                  type: "image",
                  url,
                  index: collectedUrls.length - 1,
                };
              }
            }
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (collectedUrls.length === 0) {
    yield { type: "error", message: "No images generated" };
    return;
  }

  yield { type: "done" };
}

/**
 * Parse a data URL into its components
 * Returns { mimeType, base64Content } or null
 */
export function parseDataUrl(dataUrl: string): { mimeType: string; base64Content: string } | null {
  if (!dataUrl.startsWith("data:")) return null;

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) return null;

  const header = dataUrl.slice(0, commaIndex);
  const base64Content = dataUrl.slice(commaIndex + 1);

  if (!header.includes(";base64")) return null;

  const mimeType = header.slice(5).split(";")[0] || "application/octet-stream";

  return { mimeType, base64Content };
}
