import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables (mostly for local dev, in Cloud Run it reads from the Google Cloud console)
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080; // Cloud Run requires listening on PORT environment variable, defaults to 8080

// Middleware
app.use(cors()); // Allow all origins since it's serving its own frontend
app.use(express.json({ limit: '50mb' })); // Increase limit for potential file uploads/large documents

// =============================================================================
// GEMINI API PROXY
// =============================================================================
// Replaces the Vercel serverless function. 
// Routes all Gemini SDK requests through here to attach the API key.
// =============================================================================

// Rate limiting simplified for the container (can be scaled up)
const rateLimitStore = new Map();
const MAX_REQUESTS_PER_MINUTE = 60;

function checkRateLimit(ip) {
    const now = Date.now();
    let entry = rateLimitStore.get(ip);

    if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + 60_000 };
        rateLimitStore.set(ip, entry);
    }

    if (entry.count >= MAX_REQUESTS_PER_MINUTE) {
        return false;
    }

    entry.count++;
    return true;
}

// Clean stale entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitStore.entries()) {
        if (now > entry.resetAt) rateLimitStore.delete(ip);
    }
}, 60_000);

app.post('/api/proxy', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY not configured');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    const clientIP = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIP)) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'Rate limit exceeded.', retryAfter: 60 });
    }

    try {
        const { targetUrl, method, body: requestBody } = req.body;

        if (!targetUrl || typeof targetUrl !== 'string') {
            return res.status(400).json({ error: 'Missing or invalid targetUrl' });
        }

        const parsedUrl = new URL(targetUrl);
        const allowedHosts = ['generativelanguage.googleapis.com'];

        if (!allowedHosts.includes(parsedUrl.hostname)) {
            return res.status(400).json({ error: 'Target URL not allowed' });
        }

        const isStreaming = parsedUrl.pathname.endsWith(':generateContent');

        if (isStreaming) {
            // STREAMING FIX (carried over from Vercel version but runs instantly here without timeout)
            parsedUrl.pathname = parsedUrl.pathname.replace(':generateContent', ':streamGenerateContent');
            parsedUrl.searchParams.set('key', apiKey);
            parsedUrl.searchParams.set('alt', 'sse');

            const geminiResponse = await fetch(parsedUrl.toString(), {
                method: method || 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: requestBody ? JSON.stringify(requestBody) : undefined,
            });

            if (!geminiResponse.ok) {
                const errText = await geminiResponse.text();
                return res.status(geminiResponse.status).json(JSON.parse(errText || '{}'));
            }

            // Cloud Run doesn't timeout, but we still assemble and return it for the client
            const reader = geminiResponse.body?.getReader();
            if (!reader) return res.status(500).json({ error: 'No response body' });

            const decoder = new TextDecoder();
            let fullText = '';
            let lastCandidateJson = null;
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');

                // Keep the last partial line in the buffer
                buffer = lines.pop() || '';

                for (let line of lines) {
                    line = line.trim();
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (jsonStr === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(jsonStr);
                            const parts = parsed?.candidates?.[0]?.content?.parts;
                            if (parts) {
                                for (const part of parts) {
                                    if (part.text) fullText += part.text;
                                }
                                lastCandidateJson = parsed;
                            }
                        } catch (e) {
                            // ignore partial JSON (though buffer should prevent this)
                        }
                    }
                }
            }

            // Process any remaining buffer just in case
            if (buffer.trim().startsWith('data: ')) {
                try {
                    const parsed = JSON.parse(buffer.trim().slice(6).trim());
                    const parts = parsed?.candidates?.[0]?.content?.parts;
                    if (parts) {
                        for (const part of parts) {
                            if (part.text) fullText += part.text;
                        }
                        lastCandidateJson = parsed;
                    }
                } catch (e) { }
            }

            const assembled = lastCandidateJson
                ? {
                    ...lastCandidateJson,
                    candidates: [
                        {
                            ...lastCandidateJson.candidates?.[0],
                            content: { role: 'model', parts: [{ text: fullText }] },
                        },
                    ],
                }
                : { candidates: [{ content: { role: 'model', parts: [{ text: fullText }] } }] };

            return res.json(assembled);

        } else {
            // Non-streaming (e.g. models list)
            parsedUrl.searchParams.set('key', apiKey);

            const geminiResponse = await fetch(parsedUrl.toString(), {
                method: method || 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: requestBody ? JSON.stringify(requestBody) : undefined,
            });

            const responseData = await geminiResponse.text();
            res.status(geminiResponse.status);
            res.setHeader('Content-Type', geminiResponse.headers.get('content-type') || 'application/json');
            return res.send(responseData);
        }

    } catch (error) {
        console.error('Proxy error:', error);
        return res.status(500).json({ error: 'Proxy request failed', message: error.message || 'Unknown error' });
    }
});

// =============================================================================
// SERVE STATIC FRONTEND (REACT/VITE)
// =============================================================================
// In production, Vite builds to the "dist" folder.
// Express will serve these static files.

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// Catch-all route for React client-side routing
app.get(/^(?!\/api).*/, (req, res, next) => {
    // If it's an API route that somehow fell through, next() it so it 404s properly
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Serving static files from ${distPath}`);
});
