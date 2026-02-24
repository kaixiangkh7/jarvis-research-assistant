import type { VercelRequest, VercelResponse } from '@vercel/node';

// =============================================================================
// GEMINI API PROXY — Vercel Serverless Function
// =============================================================================
// This is the ONLY place the API key lives. It never reaches the client.
// All Gemini SDK requests from the frontend are routed through this proxy.
// =============================================================================

export const maxDuration = 60; // Tell Vercel this function can run for up to 60s

// --- RATE LIMITING (In-Memory, per serverless instance) ---
interface RateLimitEntry {
    minuteCount: number;
    hourCount: number;
    minuteReset: number;
    hourReset: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const RATE_LIMITS = {
    perMinute: 20,   // max requests per minute per IP
    perHour: 200,    // max requests per hour per IP
};

function getClientIP(req: VercelRequest): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    if (Array.isArray(forwarded)) return forwarded[0].trim();
    return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    let entry = rateLimitStore.get(ip);

    if (!entry) {
        entry = {
            minuteCount: 0,
            hourCount: 0,
            minuteReset: now + 60_000,
            hourReset: now + 3_600_000,
        };
        rateLimitStore.set(ip, entry);
    }

    if (now > entry.minuteReset) {
        entry.minuteCount = 0;
        entry.minuteReset = now + 60_000;
    }
    if (now > entry.hourReset) {
        entry.hourCount = 0;
        entry.hourReset = now + 3_600_000;
    }

    if (entry.minuteCount >= RATE_LIMITS.perMinute) {
        return { allowed: false, retryAfter: Math.ceil((entry.minuteReset - now) / 1000) };
    }
    if (entry.hourCount >= RATE_LIMITS.perHour) {
        return { allowed: false, retryAfter: Math.ceil((entry.hourReset - now) / 1000) };
    }

    entry.minuteCount++;
    entry.hourCount++;
    return { allowed: true };
}

// Clean stale entries periodically (prevent memory leak)
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitStore.entries()) {
        if (now > entry.hourReset + 3_600_000) {
            rateLimitStore.delete(ip);
        }
    }
}, 300_000); // Every 5 minutes

// --- CORS ---
function getAllowedOrigins(): string[] {
    const origins: string[] = [];
    if (process.env.ALLOWED_ORIGIN) origins.push(process.env.ALLOWED_ORIGIN);
    if (process.env.VERCEL_URL) origins.push(`https://${process.env.VERCEL_URL}`);
    if (process.env.VERCEL_BRANCH_URL) origins.push(`https://${process.env.VERCEL_BRANCH_URL}`);
    return origins;
}

function isOriginAllowed(req: VercelRequest, origin: string | undefined): boolean {
    if (!origin) return false;
    const allowed = getAllowedOrigins();
    if (allowed.length === 0) return true;
    if (allowed.some(a => origin.startsWith(a) || origin === a)) return true;

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (host && origin.includes(host as string)) return true;
    if (process.env.VERCEL === '1' && origin.endsWith('.vercel.app')) return true;

    return false;
}

// =============================================================================
// MAIN HANDLER
// =============================================================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // --- CORS Headers ---
    const origin = req.headers.origin as string | undefined;
    if (origin && isOriginAllowed(req, origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // --- API Key Check ---
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY not configured');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    // --- Rate Limiting ---
    const clientIP = getClientIP(req);
    const rateCheck = checkRateLimit(clientIP);
    if (!rateCheck.allowed) {
        res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
        return res.status(429).json({ error: 'Rate limit exceeded.', retryAfter: rateCheck.retryAfter });
    }

    if (!isOriginAllowed(req, origin)) return res.status(403).json({ error: 'Forbidden: Invalid origin' });

    // --- Parse & Validate Body ---
    try {
        const body = req.body;
        if (!body) return res.status(400).json({ error: 'Request body is required' });

        const { targetUrl, method, body: requestBody } = body;

        if (!targetUrl || typeof targetUrl !== 'string') {
            return res.status(400).json({ error: 'Missing or invalid targetUrl' });
        }

        const allowedHosts = ['generativelanguage.googleapis.com'];
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(targetUrl);
        } catch {
            return res.status(400).json({ error: 'Invalid targetUrl format' });
        }

        if (!allowedHosts.includes(parsedUrl.hostname)) {
            return res.status(400).json({ error: 'Target URL not allowed' });
        }

        parsedUrl.searchParams.set('key', apiKey);

        // Fetch from Google (add streaming parameter)
        if (requestBody && !parsedUrl.toString().includes('stream=')) {
            parsedUrl.searchParams.set('alt', 'sse'); // Request Server-Sent Events from Gemini if possible, or just stream
        }

        const geminiResponse = await fetch(parsedUrl.toString(), {
            method: method || 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody ? JSON.stringify(requestBody) : undefined,
        });

        res.status(geminiResponse.status);
        res.setHeader('Content-Type', geminiResponse.headers.get('content-type') || 'application/json');

        if (!geminiResponse.body) {
            return res.send(await geminiResponse.text());
        }

        // Stream the response directly to the client to bypass Vercel's 60s idle timeout
        const reader = geminiResponse.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
        }
        res.end();


    } catch (error: any) {
        console.error('Proxy error:', error);
        return res.status(500).json({ error: 'Proxy request failed', message: error.message || 'Unknown error' });
    }
}
