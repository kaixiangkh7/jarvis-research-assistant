export const config = {
    runtime: 'edge',
};

// =============================================================================
// GEMINI API PROXY — Vercel Edge Function
// =============================================================================
// This is the ONLY place the API key lives. It never reaches the client.
// All Gemini SDK requests from the frontend are routed through this proxy.
// It uses Vercel Edge to stream the response back and bypass Hobby 10s timeouts.
// =============================================================================

// --- RATE LIMITING (In-Memory, per Edge isolate) ---
interface RateLimitEntry {
    minuteCount: number;
    hourCount: number;
    minuteReset: number;
    hourReset: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const RATE_LIMITS = {
    perMinute: 20,
    perHour: 200,
};

function getClientIP(req: Request): string {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
    return 'unknown';
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();

    // Lazy cleanup of old entries
    if (Math.random() < 0.05) { // 5% chance on each request to cleanup
        for (const [key, val] of rateLimitStore.entries()) {
            if (now > val.hourReset + 3_600_000) rateLimitStore.delete(key);
        }
    }

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

// --- CORS ---
function getAllowedOrigins(): string[] {
    const origins: string[] = [];
    if (process.env.ALLOWED_ORIGIN) origins.push(process.env.ALLOWED_ORIGIN);
    if (process.env.VERCEL_URL) origins.push(`https://${process.env.VERCEL_URL}`);
    if (process.env.VERCEL_BRANCH_URL) origins.push(`https://${process.env.VERCEL_BRANCH_URL}`);
    return origins;
}

function isOriginAllowed(req: Request, origin: string | null): boolean {
    if (!origin) return false;
    const allowed = getAllowedOrigins();
    if (allowed.length === 0) return true;
    if (allowed.some(a => origin.startsWith(a) || origin === a)) return true;

    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    if (host && origin.includes(host)) return true;
    if (process.env.VERCEL === '1' && origin.endsWith('.vercel.app')) return true;

    return false;
}

const sendJson = (data: any, status: number, headers = new Headers()) => {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify(data), { status, headers });
};

// =============================================================================
// MAIN HANDLER
// =============================================================================
export default async function handler(req: Request) {
    const origin = req.headers.get('origin');
    const corsHeaders = new Headers();

    if (origin && isOriginAllowed(req, origin)) {
        corsHeaders.set('Access-Control-Allow-Origin', origin);
    }
    corsHeaders.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type');
    corsHeaders.set('Access-Control-Max-Age', '86400');

    // Handle Preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return sendJson({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    // --- API Key Check ---
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY not configured');
        return sendJson({ error: 'Server configuration error' }, 500, corsHeaders);
    }

    // --- Rate Limiting ---
    const clientIP = getClientIP(req);
    const rateCheck = checkRateLimit(clientIP);
    if (!rateCheck.allowed) {
        corsHeaders.set('Retry-After', String(rateCheck.retryAfter || 60));
        return sendJson({ error: 'Rate limit exceeded' }, 429, corsHeaders);
    }

    // --- Origin Check ---
    if (!isOriginAllowed(req, origin)) {
        return sendJson({ error: 'Forbidden: Invalid origin' }, 403, corsHeaders);
    }

    // --- Parse Body ---
    try {
        const body = await req.json();
        const { targetUrl, method, body: requestBody } = body;

        if (!targetUrl || typeof targetUrl !== 'string') {
            return sendJson({ error: 'Missing targetUrl' }, 400, corsHeaders);
        }

        const allowedHosts = ['generativelanguage.googleapis.com'];
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(targetUrl);
        } catch {
            return sendJson({ error: 'Invalid targetUrl format' }, 400, corsHeaders);
        }

        if (!allowedHosts.includes(parsedUrl.hostname)) {
            return sendJson({ error: 'Target URL not allowed' }, 400, corsHeaders);
        }

        parsedUrl.searchParams.set('key', apiKey);

        // Forward to Gemini
        const geminiResponse = await fetch(parsedUrl.toString(), {
            method: method || 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody ? JSON.stringify(requestBody) : undefined,
        });

        // Add headers from Gemini
        const responseHeaders = new Headers(corsHeaders);
        responseHeaders.set('Content-Type', geminiResponse.headers.get('content-type') || 'application/json');

        // Stream the response body back immediately to bypass Vercel Hobby 10s idle limits!
        return new Response(geminiResponse.body, {
            status: geminiResponse.status,
            headers: responseHeaders,
        });

    } catch (error: any) {
        console.error('Edge Proxy error:', error);
        return sendJson({ error: 'Proxy request failed', message: error.message }, 500, corsHeaders);
    }
}
