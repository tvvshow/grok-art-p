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
const MEDIA_POST_API = "https://grok.com/rest/media/post/create";

export interface ImageEditUpdate {
  type: "progress" | "image" | "error" | "done" | "debug";
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

  const raw = await response.json();
  const result = raw as UploadResult;
  if (!result.fileMetadataId && !result.fileUri) {
    throw new Error(`Upload returned empty result: ${JSON.stringify(raw).slice(0, 500)}`);
  }

  return result;
}

/**
 * Create a media post for the uploaded image.
 * Returns the parentPostId needed for image editing.
 * Falls back to extracting UUID from fileUri if API call fails.
 */
export async function createMediaPost(
  sso: string,
  ssoRw: string,
  imageUrl: string,
  fileUri: string
): Promise<string> {
  const cookie = buildCookie(sso, ssoRw);
  const headers = getHeaders(cookie);

  try {
    const response = await fetch(MEDIA_POST_API, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mediaType: "MEDIA_POST_TYPE_IMAGE",
        mediaUrl: imageUrl,
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as { post?: { id?: string } };
      if (data?.post?.id) {
        return data.post.id;
      }
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: extract UUID from fileUri pattern users/{userId}/{uuid}/content
  const match = fileUri.match(/users\/[^/]+\/([a-f0-9-]+)\/content/);
  if (match?.[1]) {
    return match[1];
  }

  return "";
}

/**
 * Recursively collect image URLs from response object.
 * Looks for keys: generatedImageUrls, imageUrls, imageURLs
 * (matches grok2api _collect_images behavior)
 */
function collectImages(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];

  const urls: string[] = [];
  const targetKeys = new Set(["generatedImageUrls", "imageUrls", "imageURLs", "imageEditUris", "fileUris"]);

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
        if (typeof item === "string" && item.length > 0) {
          if (item.startsWith("http")) {
            urls.push(item);
          } else if (item.startsWith("/") || item.startsWith("users/")) {
            // Relative URI — construct full URL
            urls.push(`https://assets.grok.com/${item.replace(/^\//, "")}`);
          }
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
  imageCount: number = 2,
  parentPostId?: string,
  fileMetadataId?: string
): AsyncGenerator<ImageEditUpdate> {
  const cookie = buildCookie(sso, ssoRw);
  const headers = getHeaders(cookie);

  // Payload structure matches grok2api AppChatReverse.build_payload()
  const imageEditModelConfig: Record<string, unknown> = {
    imageReferences: imageUrls,
  };
  if (parentPostId) {
    imageEditModelConfig.parentPostId = parentPostId;
  }

  const modelConfigOverride = {
    modelMap: {
      imageEditModel: "imagine",
      imageEditModelConfig,
    },
    imageEditModel: "imagine", // Also needed at top level for some versions
  };

  const payload: Record<string, unknown> = {
    temporary: true,
    modelName: "grok-3-image-generation",
    modelMode: null,
    message: prompt || "Generate new variations based on this image",
    fileAttachments: fileMetadataId ? [fileMetadataId] : [],
    imageAttachments: fileMetadataId ? [fileMetadataId] : [],
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
      requestModelDetails: { modelId: "grok-3-image-generation" },
      modelConfigOverride,
    },
  };

  yield { type: "debug", message: `imageRefs: ${JSON.stringify(imageUrls)}` };
  yield { type: "debug", message: `payload.imageAttachments: ${JSON.stringify(payload.imageAttachments)}` };
  yield { type: "debug", message: `payload.modelConfigOverride: ${JSON.stringify(modelConfigOverride)}` };

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

  yield { type: "debug", message: `Chat API status: ${response.status}` };

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const status = response.status;
    yield { type: "debug", message: `Chat API error body: ${text.slice(0, 500)}` };
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
  let lineCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        lineCount++;

        try {
          const data = JSON.parse(line);
          const resp = data?.result?.response;

          // Debug: log first few lines and any line with interesting keys
          if (lineCount <= 3) {
            const keys = resp ? Object.keys(resp).join(",") : "no-resp";
            yield { type: "debug", message: `line#${lineCount} resp-keys: [${keys}]` };
          }

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
            // Debug: show values of key image fields
            const mr = modelResponse as Record<string, unknown>;
            for (const k of ["generatedImageUrls", "imageEditUris", "fileUris", "imageUrls"]) {
              if (mr[k] !== undefined && mr[k] !== null) {
                yield { type: "debug", message: `${k}: ${JSON.stringify(mr[k]).slice(0, 300)}` };
              }
            }
            const urls = collectImages(modelResponse);
            yield { type: "debug", message: `collectImages found ${urls.length} urls` };
            if (urls.length > 0) {
              yield { type: "debug", message: `first url: ${urls[0]!.slice(0, 100)}` };
            }
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

          // Also check for images directly in resp (not nested in modelResponse)
          const directUrls = collectImages(resp);
          for (const url of directUrls) {
            if (!collectedUrls.includes(url)) {
              collectedUrls.push(url);
              yield { type: "debug", message: `found url in resp (not modelResponse): ${url.slice(0, 100)}` };
              yield {
                type: "image",
                url,
                index: collectedUrls.length - 1,
              };
            }
          }
        } catch {
          // Log first unparseable line
          if (lineCount <= 2) {
            yield { type: "debug", message: `unparseable line#${lineCount}: ${line.slice(0, 200)}` };
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { type: "debug", message: `stream done. ${lineCount} lines, ${collectedUrls.length} images` };

  if (collectedUrls.length === 0) {
    yield { type: "error", message: `No images generated (parsed ${lineCount} lines)` };
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
