// Event Bus for simple state management
class EventBus {
    constructor() {
        this.listeners = {};
    }

    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(cb => cb(data));
        }
    }
}

export const bus = new EventBus();

// Logger
export function log(elementId, message, type = 'info') {
    const logEl = document.getElementById(elementId);
    if (!logEl) return;

    const line = document.createElement('div');
    line.className = `log-line ${type}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] > ${message}`;

    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
}

export function clearLog(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.innerHTML = '';
}

// API Wrapper
export async function api(url, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);

    try {
        const resp = await fetch(url, options);
        if (!resp.ok) {
            const errorText = await resp.text();
            try {
                const errorJson = JSON.parse(errorText);
                throw new Error(errorJson.detail || errorJson.message || resp.statusText);
            } catch (e) {
                throw new Error(errorText || resp.statusText);
            }
        }
        return await resp.json();
    } catch (e) {
        throw e;
    }
}

// SSE Stream Reader for custom POST-based streams
export async function readStream(url, body, callbacks) {
    const { onProgress, onData, onInfo, onError, onDone, onDebug } = callbacks;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                // Stream ended, trigger onDone if not already called
                if (onDone) onDone({});
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep incomplete line

            for (const line of lines) {
                const trimmed = line.trim();

                // Empty line marks end of an event block
                if (!trimmed) {
                    currentEvent = null;
                    continue;
                }

                // Parse event type line
                if (trimmed.startsWith('event: ')) {
                    currentEvent = trimmed.substring(7).trim();
                    continue;
                }

                // Parse data line
                if (trimmed.startsWith('data: ')) {
                    try {
                        const jsonStr = trimmed.substring(6);
                        const data = JSON.parse(jsonStr);

                        // Use explicit event type if available, fallback to data.type
                        const eventType = currentEvent || data.type;

                        switch (eventType) {
                            case 'progress':
                                if (onProgress) onProgress(data);
                                break;
                            case 'image':
                            case 'complete':
                                if (onData) onData(data);
                                break;
                            case 'info':
                            case 'start':
                                if (onInfo) onInfo(data);
                                break;
                            case 'error':
                                if (onError) onError(data.message || data.error || '未知错误');
                                break;
                            case 'done':
                                if (onDone) onDone(data);
                                return; // Stop processing
                            case 'debug':
                                if (onDebug) onDebug(data);
                                break;
                        }
                    } catch (e) {
                        console.warn('解析 SSE 数据失败:', line, e);
                    }
                }
            }
        }
    } catch (e) {
        if (onError) onError(e.message);
        // Also call onDone on error to reset UI state
        if (onDone) onDone({});
    }
}
