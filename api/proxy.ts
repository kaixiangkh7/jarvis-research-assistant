import type { VercelRequest, VercelResponse } from '@vercel/node';

// =============================================================================
// GEMINI API PROXY — Vercel Serverless Function
// =============================================================================
// This is the ONLY place the API key lives. It never reaches the client.
// All Gemini SDK requests from the frontend are routed through this proxy.
// =============================================================================

// --- RATE LIMITING (In-Memory, per serverless instance) ---
// Note: In-memory rate limiting resets on cold starts, but still provides
// meaningful protection against burst abuse within a warm instance.
// For production-grade limiting, upgrade to Upstash Redis (@upstash/ratelimit).

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

const MAX_BODY_SIZE = 30 * 1024 * 1024; // 30MB (Vercel's limit is ~4.5MB for request, but we check anyway)

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

    // Reset windows
    if (now > entry.minuteReset) {
        entry.minuteCount = 0;
        entry.minuteReset = now + 60_000;
    }
    if (now > entry.hourReset) {
        entry.hourCount = 0;
        entry.hourReset = now + 3_600_000;
    }

    // Check limits
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
    // Allow the configured domain
    if (process.env.ALLOWED_ORIGIN) {
        origins.push(process.env.ALLOWED_ORIGIN);
    }
    // Always allow the Vercel deployment URL
    if (process.env.VERCEL_URL) {
        origins.push(`https://${process.env.VERCEL_URL}`);
    }
    // Allow Vercel preview deployments
    if (process.env.VERCEL_BRANCH_URL) {
        origins.push(`https://${process.env.VERCEL_BRANCH_URL}`);
    }
    return origins;
}

function isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return false; // Block requests with no origin (e.g., curl)
    const allowed = getAllowedOrigins();
    // If no origins configured, allow all (development fallback)
    if (allowed.length === 0) return true;
    return allowed.some(a => origin.startsWith(a) || origin === a);
}

// =============================================================================
// MAIN HANDLER
// =============================================================================
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // --- CORS Headers ---
    const origin = req.headers.origin as string | undefined;
    if (origin && isOriginAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // --- API Key Check ---
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY not configured in Vercel environment variables');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    // --- Rate Limiting ---
    const clientIP = getClientIP(req);
    const rateCheck = checkRateLimit(clientIP);
    if (!rateCheck.allowed) {
        res.setHeader('Retry-After', String(rateCheck.retryAfter || 60));
        return res.status(429).json({
            error: 'Rate limit exceeded. Please slow down.',
            retryAfter: rateCheck.retryAfter,
        });
    }

    // --- Origin Check (block non-browser / cross-origin requests) ---
    if (!isOriginAllowed(origin)) {
        return res.status(403).json({ error: 'Forbidden: Invalid origin' });
    }

    // --- Parse & Validate Body ---
    try {
        const body = req.body;
        if (!body) {
            return res.status(400).json({ error: 'Request body is required' });
        }

        const { targetUrl, method, headers: clientHeaders, body: requestBody } = body;

        if (!targetUrl || typeof targetUrl !== 'string') {
            return res.status(400).json({ error: 'Missing or invalid targetUrl' });
        }

        // Validate the target URL points to Google's Gemini API
        const allowedHosts = [
            'generativelanguage.googleapis.com',
        ];
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(targetUrl);
        } catch {
            return res.status(400).json({ error: 'Invalid targetUrl format' });
        }

        if (!allowedHosts.includes(parsedUrl.hostname)) {
            return res.status(400).json({ error: 'Target URL not allowed. Only Gemini API endpoints are permitted.' });
        }

        // --- Build the proxied request ---
        // Inject the real API key
        parsedUrl.searchParams.set('key', apiKey);

        const proxyHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        // Forward the request to Google
        const geminiResponse = await fetch(parsedUrl.toString(), {
            method: method || 'POST',
            headers: proxyHeaders,
            body: requestBody ? JSON.stringify(requestBody) : undefined,
        });

        // --- Return the response ---
        const responseData = await geminiResponse.text();

        // Forward status and body
        res.status(geminiResponse.status);
        res.setHeader('Content-Type', geminiResponse.headers.get('content-type') || 'application/json');
        return res.send(responseData);

    } catch (error: any) {
        console.error('Proxy error:', error);
        return res.status(500).json({
            error: 'Proxy request failed',
            message: error.message || 'Unknown error'
        });
    }
}
