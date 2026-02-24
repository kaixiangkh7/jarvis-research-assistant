// =============================================================================
// PROXY CLIENT — Drop-in replacement for GoogleGenAI SDK in production
// =============================================================================
// In development (API key available), uses the SDK directly.
// In production (no API key), routes all requests through /api/proxy.
// =============================================================================

import { GoogleGenAI, Type, Schema, Chat } from "@google/genai";

const GEMINI_API_KEY = process.env.API_KEY || '';
const IS_PRODUCTION = !GEMINI_API_KEY;

// --- Direct SDK client (used in development) ---
const directClient = GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: GEMINI_API_KEY })
    : null;

// =============================================================================
// PROXY FETCH HELPER
// =============================================================================
// Sends requests to /api/proxy which forwards them to Google's Gemini API.
// The proxy adds the API key server-side.

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

async function proxyFetch(
    path: string,
    requestBody: any,
    abortSignal?: AbortSignal
): Promise<any> {
    const targetUrl = `${GEMINI_BASE_URL}${path}`;

    const response = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            targetUrl,
            method: 'POST',
            body: requestBody,
        }),
        signal: abortSignal,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        let errorData: any;
        try { errorData = JSON.parse(errorBody); } catch { errorData = { message: errorBody }; }

        const error: any = new Error(errorData?.error?.message || errorData?.error || errorData?.message || `API error: ${response.status}`);
        error.status = response.status;
        error.response = { status: response.status };
        throw error;
    }

    // Since we stream it back from proxy using alt=sse, we need to read the stream
    // and reconstruct the final JSON text before parsing it.
    const reader = response.body?.getReader();
    if (!reader) {
        return response.json();
    }

    const decoder = new TextDecoder();
    let resultText = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resultText += decoder.decode(value, { stream: true });
    }

    // The response is now a series of Server-Sent Events: "data: {...}\n\n"
    // We need to extract all the text pieces and combine them.
    const lines = resultText.split('\n');
    let fullContent = '';
    let lastCandidateInfo = null;

    for (const line of lines) {
        if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '').trim();
            if (dataStr === '[DONE]') continue;
            try {
                const chunk = JSON.parse(dataStr);
                if (chunk.candidates && chunk.candidates[0].content && chunk.candidates[0].content.parts) {
                    fullContent += chunk.candidates[0].content.parts.map((p: any) => p.text || '').join('');
                    // Keep the last candidate info for the final stub
                    lastCandidateInfo = chunk.candidates[0];
                }
            } catch (e) {
                console.warn('Failed to parse SSE chunk', dataStr);
            }
        }
    }

    // Stub a response object that looks like the standard unary response
    return {
        candidates: [
            {
                ...lastCandidateInfo,
                content: {
                    parts: [{ text: fullContent }]
                }
            }
        ]
    };
}

// =============================================================================
// Schema serialization helper
// =============================================================================
// The Schema objects from the SDK use Type enum values. When we send them
// through the proxy, we need to serialize them as plain objects.

function serializeSchema(schema: any): any {
    if (!schema) return undefined;
    if (typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map(serializeSchema);

    const result: any = {};
    for (const [key, value] of Object.entries(schema)) {
        result[key] = serializeSchema(value);
    }
    return result;
}

// =============================================================================
// BUILD CONTENTS FOR REST API
// =============================================================================
// The SDK accepts various content formats. We need to normalize them
// for the REST API when going through the proxy.

function normalizeContents(contents: any): any {
    if (typeof contents === 'string') {
        return [{ role: 'user', parts: [{ text: contents }] }];
    }
    if (Array.isArray(contents)) {
        // Array of mixed content (strings, inline data, etc.)
        const parts: any[] = contents.map(item => {
            if (typeof item === 'string') return { text: item };
            if (item.inlineData) return item;
            if (item.text) return item;
            return item;
        });
        return [{ role: 'user', parts }];
    }
    if (contents && contents.role && contents.parts) {
        // Already a Content object
        return [contents];
    }
    return contents;
}

// =============================================================================
// PROXY-AWARE API CLIENT
// =============================================================================
// Provides the same interface as the GoogleGenAI SDK but routes through proxy.

interface GenerateContentParams {
    model: string;
    contents: any;
    config?: {
        systemInstruction?: string;
        responseMimeType?: string;
        responseSchema?: any;
        temperature?: number;
        maxOutputTokens?: number;
        thinkingConfig?: { thinkingBudget: number };
        tools?: any[];
        abortSignal?: AbortSignal;
    };
}

interface ChatCreateParams {
    model: string;
    config?: {
        temperature?: number;
        thinkingConfig?: { thinkingBudget: number };
        systemInstruction?: string;
        tools?: any[];
    };
}

// Proxy-based generateContent
async function proxyGenerateContent(params: GenerateContentParams): Promise<{ text: string }> {
    const { model, contents, config } = params;
    const abortSignal = config?.abortSignal;

    // Build REST API request body
    const requestBody: any = {
        contents: normalizeContents(contents),
    };

    // System instruction
    if (config?.systemInstruction) {
        requestBody.systemInstruction = {
            parts: [{ text: config.systemInstruction }]
        };
    }

    // Generation config
    const generationConfig: any = {};
    if (config?.temperature !== undefined) generationConfig.temperature = config.temperature;
    if (config?.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = config.maxOutputTokens;
    if (config?.responseMimeType) generationConfig.responseMimeType = config.responseMimeType;
    if (config?.responseSchema) generationConfig.responseSchema = serializeSchema(config.responseSchema);
    if (config?.thinkingConfig) generationConfig.thinkingConfig = config.thinkingConfig;

    if (Object.keys(generationConfig).length > 0) {
        requestBody.generationConfig = generationConfig;
    }

    // Tools
    if (config?.tools) {
        requestBody.tools = config.tools;
    }

    const path = `/v1beta/models/${model}:generateContent`;
    const data = await proxyFetch(path, requestBody, abortSignal);

    // Extract text from response (same format as Gemini REST API)
    const text = data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text || '')
        .join('') || '';

    return { text };
}

// Proxy-based chat (maintains history client-side)
class ProxyChat {
    private model: string;
    private config: any;
    private history: any[] = [];

    constructor(params: ChatCreateParams) {
        this.model = params.model;
        this.config = params.config || {};
    }

    async sendMessage(params: { message: any; config?: { abortSignal?: AbortSignal } }): Promise<{ text: string }> {
        const { message, config } = params;
        const abortSignal = config?.abortSignal;

        // Build user message parts
        let parts: any[];
        if (typeof message === 'string') {
            parts = [{ text: message }];
        } else if (Array.isArray(message)) {
            parts = message.map(item => {
                if (typeof item === 'string') return { text: item };
                return item;
            });
        } else {
            parts = [message];
        }

        // Add user message to history
        this.history.push({ role: 'user', parts });

        // Build request
        const requestBody: any = {
            contents: this.history,
        };

        if (this.config.systemInstruction) {
            requestBody.systemInstruction = {
                parts: [{ text: this.config.systemInstruction }]
            };
        }

        const generationConfig: any = {};
        if (this.config.temperature !== undefined) generationConfig.temperature = this.config.temperature;
        if (this.config.thinkingConfig) generationConfig.thinkingConfig = this.config.thinkingConfig;
        if (Object.keys(generationConfig).length > 0) {
            requestBody.generationConfig = generationConfig;
        }

        if (this.config.tools) {
            requestBody.tools = this.config.tools;
        }

        const path = `/v1beta/models/${this.model}:generateContent`;
        const data = await proxyFetch(path, requestBody, abortSignal);

        const responseText = data?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p.text || '')
            .join('') || '';

        // Add model response to history
        this.history.push({
            role: 'model',
            parts: [{ text: responseText }]
        });

        return { text: responseText };
    }
}

// =============================================================================
// UNIFIED CLIENT EXPORT
// =============================================================================
// This object provides the same interface as GoogleGenAI but transparently
// switches between direct SDK and proxy based on environment.

export const ai = {
    models: {
        generateContent: async (params: GenerateContentParams) => {
            if (!IS_PRODUCTION && directClient) {
                // Development: use SDK directly
                return directClient.models.generateContent(params);
            }
            // Production: use proxy
            return proxyGenerateContent(params);
        }
    },
    chats: {
        create: (params: ChatCreateParams) => {
            if (!IS_PRODUCTION && directClient) {
                // Development: use SDK directly
                return directClient.chats.create(params);
            }
            // Production: use proxy chat
            return new ProxyChat(params) as unknown as Chat;
        }
    }
};
