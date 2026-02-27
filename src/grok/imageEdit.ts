/**
 * Grok Image Edit Service - Upload image + Chat API based image-to-image generation
 *
 * Flow:
 * 1. Upload user image to https://grok.com/rest/app-chat/upload-file
 * 2. Use chat API with toolOverrides + modelConfigOverride for image editing
 * 3. Parse streaming response for generated image URLs
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
 * Build the full Grok asset URL from upload result
 */
function buildAssetUrl(fileUri: string): string {
  if (fileUri.startsWith("http")) return fileUri;
  return `https://assets.grok.com/${fileUri.replace(/^\//, "")}`;
}

/**
 * Extract image URLs from modelResponse text
 */
function extractImageUrls(modelResponse: Record<string, unknown>): string[] {
  const urls: string[] = [];

  // Check generatedImageEditUrls (structured field)
  const editUrls = modelResponse.generatedImageEditUrls;
  if (Array.isArray(editUrls)) {
    for (const u of editUrls) {
      if (typeof u === "string" && u.startsWith("http")) urls.push(u);
    }
  }

  // Check generatedAssets
  const assets = modelResponse.generatedAssets;
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      const a = asset as Record<string, unknown>;
      if (typeof a.url === "string") urls.push(a.url);
      if (typeof a.imageUrl === "string") urls.push(a.imageUrl);
    }
  }

  // Check imageAttachments
  const attachments = modelResponse.imageAttachments;
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      if (typeof att === "string" && att.startsWith("http")) urls.push(att);
    }
  }

  // Fallback: extract URLs from outputText/message using regex
  const textFields = ["outputText", "message", "text"];
  for (const field of textFields) {
    const text = modelResponse[field];
    if (typeof text === "string") {
      const pattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+\.(?:jpg|jpeg|png|gif|webp)/gi;
      const matches = text.match(pattern);
      if (matches) urls.push(...matches);
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
  imageCount: number = 4
): AsyncGenerator<ImageEditUpdate> {
  const cookie = buildCookie(sso, ssoRw);
  const headers = getHeaders(cookie);

  const payload = {
    temporary: true,
    modelName: "grok-3",
    modelMode: "normal",
    message: prompt || "Generate new variations based on this image",
    fileAttachments: [],
    imageAttachments: [],
    disableSearch: true,
    enableImageGeneration: true,
    returnImageBytes: false,
    returnRawGrokInXaiRequest: false,
    enableImageStreaming: true,
    imageGenerationCount: imageCount,
    forceConcise: false,
    toolOverrides: { imageGen: true },
    enableSideBySide: false,
    sendFinalMetadata: true,
    isReasoning: false,
    disableTextFollowUps: true,
    disableMemory: true,
    forceSideBySide: false,
    isAsyncChat: false,
    disableSelfHarmShortCircuit: false,
    responseMetadata: {
      modelConfigOverride: {
        modelMap: {
          imageEditModel: "imagine",
          imageEditModelConfig: {
            imageReferences: imageUrls,
          },
        },
      },
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

          // Final modelResponse with image URLs
          const modelResponse = resp.modelResponse;
          if (modelResponse) {
            const urls = extractImageUrls(modelResponse);
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
