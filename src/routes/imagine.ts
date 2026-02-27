import { Hono } from "hono";
import type { Env } from "../env";
import { getToken, getRandomToken, type TokenRow } from "../repo/tokens";
import { generateImages, type StreamUpdate } from "../grok/imagine";
import { generateVideo, type VideoUpdate } from "../grok/video";
import { uploadImage, streamImageEdit, parseDataUrl } from "../grok/imageEdit";
import { getHeaders, buildCookie } from "../grok/headers";

type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>();

const MAX_RETRIES = 5;

// Image generation (SSE stream) with auto-retry on 429
app.post("/api/imagine/generate", async (c) => {
  const body = await c.req.json<{
    prompt: string;
    aspect_ratio?: string;
    enable_nsfw?: boolean;
    count?: number;
    token_id?: string;
  }>();

  const { prompt, aspect_ratio = "2:3", enable_nsfw = true, count = 10, token_id } = body;

  // Stream SSE response
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  const writeEvent = async (event: string, data: unknown) => {
    await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  // Capture db reference before async context
  const db = c.env.DB;

  // Generate images with retry logic
  const backgroundTask = (async () => {
    const excludedTokenIds: string[] = [];
    let retryCount = 0;
    let totalCollected = 0;
    const targetCount = count;

    while (retryCount < MAX_RETRIES && totalCollected < targetCount) {
      // Get token (excluding rate-limited ones)
      let token: TokenRow | null = null;

      if (token_id && retryCount === 0) {
        token = await getToken(db, token_id);
      }

      if (!token) {
        token = await getRandomToken(db, excludedTokenIds);
      }

      if (!token) {
        if (excludedTokenIds.length > 0) {
          await writeEvent("error", {
            type: "error",
            message: `All tokens rate limited (tried ${excludedTokenIds.length} tokens)`,
          });
        } else {
          await writeEvent("error", {
            type: "error",
            message: "No available tokens. Please import tokens first.",
          });
        }
        break;
      }

      try {
        const remainingCount = targetCount - totalCollected;

        for await (const update of generateImages(
          token.sso,
          token.sso_rw,
          prompt,
          remainingCount,
          aspect_ratio,
          enable_nsfw
        )) {
          if (update.type === "error") {
            const msg = update.message;

            // Check for 429 rate limit
            if (msg.includes("429") || msg.includes("Rate limited")) {
              excludedTokenIds.push(token.id);
              retryCount++;

              await writeEvent("info", {
                type: "info",
                message: `Token rate limited, switching to another (attempt ${retryCount}/${MAX_RETRIES})`,
              });

              // Break inner loop to retry with new token
              break;
            } else {
              // Other error, propagate it
              await writeEvent("error", update);
              await writer.close();
              return;
            }
          } else if (update.type === "image") {
            totalCollected++;
            await writeEvent("image", update);

            // Update progress with total collected
            await writeEvent("progress", {
              type: "progress",
              job_id: update.job_id,
              status: "collecting",
              percentage: (totalCollected / targetCount) * 100,
              completed_count: totalCollected,
              target_count: targetCount,
            });
          } else if (update.type === "progress") {
            // Forward progress events (except collecting which we handle above)
            if (update.status !== "collecting") {
              await writeEvent("progress", update);
            }
          } else if (update.type === "done") {
            // Check if we got enough
            if (totalCollected >= targetCount) {
              await writeEvent("done", {});
              await writer.close();
              return;
            }
            // Otherwise continue with next token if needed
            break;
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);

        if (message.includes("429") || message.includes("Rate limited")) {
          excludedTokenIds.push(token.id);
          retryCount++;

          await writeEvent("info", {
            type: "info",
            message: `Token rate limited, switching to another (attempt ${retryCount}/${MAX_RETRIES})`,
          });
          continue;
        } else {
          await writeEvent("error", {
            type: "error",
            message,
          });
          break;
        }
      }
    }

    // Final done event
    if (totalCollected > 0) {
      await writeEvent("done", {});
    }
    await writer.close();
  })();

  // Use waitUntil if available to ensure background task completes
  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(backgroundTask);
  }

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// Video generation (SSE stream) with auto-retry on 429
app.post("/api/video/generate", async (c) => {
  const body = await c.req.json<{
    image_url: string;
    prompt: string;
    parent_post_id: string;
    aspect_ratio?: string;
    video_length?: number;
    resolution?: string;
    mode?: string;
    token_id?: string;
  }>();

  const {
    image_url,
    prompt,
    parent_post_id,
    aspect_ratio = "2:3",
    video_length = 6,
    resolution = "480p",
    mode = "custom",
    token_id,
  } = body;

  // Stream SSE response
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  const writeEvent = async (event: string, data: unknown) => {
    await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  // Capture db reference before async context
  const db = c.env.DB;

  // Generate video with retry logic
  const backgroundTask = (async () => {
    const excludedTokenIds: string[] = [];
    let retryCount = 0;

    while (retryCount < MAX_RETRIES) {
      // Get token (excluding rate-limited ones)
      let token: TokenRow | null = null;

      if (token_id && retryCount === 0) {
        token = await getToken(db, token_id);
      }

      if (!token) {
        token = await getRandomToken(db, excludedTokenIds);
      }

      if (!token) {
        if (excludedTokenIds.length > 0) {
          await writeEvent("error", {
            type: "error",
            message: `All tokens rate limited (tried ${excludedTokenIds.length} tokens)`,
          });
        } else {
          await writeEvent("error", {
            type: "error",
            message: "No available tokens. Please import tokens first.",
          });
        }
        break;
      }

      try {
        let completed = false;

        for await (const update of generateVideo(
          token.sso,
          token.sso_rw,
          token.user_id,
          token.cf_clearance,
          token.id,
          image_url,
          prompt,
          parent_post_id,
          aspect_ratio,
          video_length,
          resolution,
          mode
        )) {
          if (update.type === "error") {
            const msg = update.message;

            // Check for 429 rate limit
            if (msg.includes("429") || msg.includes("Rate limited")) {
              excludedTokenIds.push(token.id);
              retryCount++;

              await writeEvent("info", {
                type: "info",
                message: `Token rate limited, switching to another (attempt ${retryCount}/${MAX_RETRIES})`,
              });

              break;
            } else {
              // Other error, propagate it
              await writeEvent("error", update);
              await writer.close();
              return;
            }
          } else if (update.type === "complete") {
            await writeEvent("complete", update);
            completed = true;
          } else if (update.type === "progress") {
            await writeEvent("progress", update);
          } else if (update.type === "done") {
            if (completed) {
              await writeEvent("done", {});
              await writer.close();
              return;
            }
          }
        }

        // If we got here without completing, try next token
        if (!completed) {
          continue;
        }
        break;

      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);

        if (message.includes("429") || message.includes("Rate limited")) {
          excludedTokenIds.push(token.id);
          retryCount++;

          await writeEvent("info", {
            type: "info",
            message: `Token rate limited, switching to another (attempt ${retryCount}/${MAX_RETRIES})`,
          });
          continue;
        } else {
          await writeEvent("error", {
            type: "error",
            message,
          });
          break;
        }
      }
    }

    await writer.close();
  })();

  // Use waitUntil if available
  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(backgroundTask);
  }

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// Scroll/load more images (SSE stream) with auto-retry on 429
app.post("/api/imagine/scroll", async (c) => {
  const body = await c.req.json<{
    prompt: string;
    aspect_ratio?: string;
    enable_nsfw?: boolean;
    max_pages?: number;
  }>();

  const { prompt, aspect_ratio = "2:3", enable_nsfw = true, max_pages = 1 } = body;

  // Stream SSE response
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  const writeEvent = async (event: string, data: unknown) => {
    await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  // Capture db reference before async context
  const db = c.env.DB;

  // Scroll with retry logic
  const backgroundTask = (async () => {
    const excludedTokenIds: string[] = [];
    let retryCount = 0;
    const imagesPerPage = 6;
    const targetCount = max_pages * imagesPerPage;

    while (retryCount < MAX_RETRIES) {
      const token = await getRandomToken(db, excludedTokenIds);

      if (!token) {
        if (excludedTokenIds.length > 0) {
          await writeEvent("error", {
            type: "error",
            message: `All tokens rate limited (tried ${excludedTokenIds.length} tokens)`,
          });
        } else {
          await writeEvent("error", {
            type: "error",
            message: "No available tokens.",
          });
        }
        break;
      }

      try {
        for await (const update of generateImages(
          token.sso,
          token.sso_rw,
          prompt,
          targetCount,
          aspect_ratio,
          enable_nsfw
        )) {
          if (update.type === "error") {
            const msg = update.message;

            if (msg.includes("429") || msg.includes("Rate limited")) {
              excludedTokenIds.push(token.id);
              retryCount++;

              await writeEvent("info", {
                type: "info",
                message: `Token rate limited, switching (attempt ${retryCount}/${MAX_RETRIES})`,
              });
              break;
            } else {
              await writeEvent("error", update);
              await writer.close();
              return;
            }
          } else if (update.type === "image") {
            await writeEvent("image", update);
          } else if (update.type === "done") {
            await writeEvent("done", {});
            await writer.close();
            return;
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);

        if (message.includes("429") || message.includes("Rate limited")) {
          excludedTokenIds.push(token.id);
          retryCount++;
          continue;
        } else {
          await writeEvent("error", { type: "error", message });
          break;
        }
      }
    }

    await writeEvent("done", {});
    await writer.close();
  })();

  // Use waitUntil if available
  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(backgroundTask);
  }

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// Image-to-image generation (SSE stream) via Chat API + upload
app.post("/api/imagine/img2img", async (c) => {
  const body = await c.req.json<{
    image_data: string;
    prompt?: string;
    count?: number;
    token_id?: string;
  }>();

  const { image_data, prompt = "", count = 4, token_id } = body;

  if (!image_data) {
    return c.json({ error: "image_data is required" }, 400);
  }

  // Parse the data URL
  const parsed = parseDataUrl(image_data);
  if (!parsed) {
    return c.json({ error: "Invalid image_data: must be a base64 data URL" }, 400);
  }

  const { mimeType, base64Content } = parsed;
  const ext = mimeType.split("/")[1] || "jpeg";
  const fileName = `upload.${ext}`;

  // Stream SSE response
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();

  const writeEvent = async (event: string, data: unknown) => {
    await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  const db = c.env.DB;

  const backgroundTask = (async () => {
    const excludedTokenIds: string[] = [];
    let retryCount = 0;

    while (retryCount < MAX_RETRIES) {
      let token: TokenRow | null = null;

      if (token_id && retryCount === 0) {
        token = await getToken(db, token_id);
      }

      if (!token) {
        token = await getRandomToken(db, excludedTokenIds);
      }

      if (!token) {
        await writeEvent("error", {
          type: "error",
          message: excludedTokenIds.length > 0
            ? `All tokens rate limited (tried ${excludedTokenIds.length} tokens)`
            : "No available tokens. Please import tokens first.",
        });
        break;
      }

      try {
        // Step 1: Upload image to Grok
        await writeEvent("progress", {
          type: "progress",
          status: "uploading",
          message: "Uploading image to Grok...",
          percentage: 10,
        });

        const uploadResult = await uploadImage(
          token.sso,
          token.sso_rw,
          fileName,
          mimeType,
          base64Content
        );

        await writeEvent("debug", {
          type: "debug",
          message: `upload result: id=${uploadResult.fileMetadataId}, uri=${uploadResult.fileUri}`,
        });

        const imageUrl = uploadResult.fileUri.startsWith("http")
          ? uploadResult.fileUri
          : `https://assets.grok.com/${uploadResult.fileUri.replace(/^\//, "")}`;

        await writeEvent("debug", {
          type: "debug",
          message: `constructed URL: ${imageUrl}`,
        });

        await writeEvent("progress", {
          type: "progress",
          status: "generating",
          message: "Generating images...",
          percentage: 30,
        });

        // Step 2: Stream image edit via chat API
        let imageCount = 0;

        for await (const update of streamImageEdit(
          token.sso,
          token.sso_rw,
          prompt,
          [imageUrl],
          Math.min(count, 4)
        )) {
          if (update.type === "error") {
            const msg = update.message || "";

            if (msg.includes("429") || msg.includes("Rate limited")) {
              excludedTokenIds.push(token.id);
              retryCount++;
              await writeEvent("info", {
                type: "info",
                message: `Token rate limited, switching (attempt ${retryCount}/${MAX_RETRIES})`,
              });
              break;
            } else {
              await writeEvent("error", { type: "error", message: msg });
              await writer.close();
              return;
            }
          } else if (update.type === "image") {
            imageCount++;
            // Use proxy URL so browser can access Grok-hosted images
            const proxiedUrl = `/api/imagine/proxy?url=${encodeURIComponent(update.url || "")}`;
            await writeEvent("image", {
              type: "image",
              url: update.url,
              image_src: proxiedUrl,
              index: update.index,
              width: 0,
              height: 0,
              prompt: prompt || "img2img",
            });

            await writeEvent("progress", {
              type: "progress",
              status: "collecting",
              percentage: 30 + (imageCount / Math.min(count, 4)) * 70,
              completed_count: imageCount,
              target_count: Math.min(count, 4),
            });
          } else if (update.type === "progress") {
            await writeEvent("progress", {
              type: "progress",
              status: "generating",
              percentage: 30 + (update.progress || 0) * 0.4,
            });
          } else if (update.type === "done") {
            await writeEvent("done", {});
            await writer.close();
            return;
          } else if (update.type === "debug") {
            await writeEvent("debug", { type: "debug", message: update.message });
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);

        if (message.includes("429") || message.includes("Rate limited")) {
          excludedTokenIds.push(token.id);
          retryCount++;
          await writeEvent("info", {
            type: "info",
            message: `Token rate limited, switching (attempt ${retryCount}/${MAX_RETRIES})`,
          });
          continue;
        } else {
          await writeEvent("error", { type: "error", message });
          break;
        }
      }
    }

    await writer.close();
  })();

  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(backgroundTask);
  }

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// Image proxy — fetches Grok-hosted images with auth cookies
app.get("/api/imagine/proxy", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.text("Missing url parameter", 400);

  // Only allow proxying assets.grok.com URLs
  if (!url.startsWith("https://assets.grok.com/")) {
    return c.text("Invalid URL", 400);
  }

  const token = await getRandomToken(c.env.DB, []);
  if (!token) return c.text("No tokens available", 503);

  const cookie = buildCookie(token.sso, token.sso_rw);
  const headers = getHeaders(cookie);

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    return c.text(`Fetch failed: ${resp.status}`, resp.status as 400);
  }

  const contentType = resp.headers.get("content-type") || "image/jpeg";
  return new Response(resp.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400",
    },
  });
});

export { app as imagineRoutes };
