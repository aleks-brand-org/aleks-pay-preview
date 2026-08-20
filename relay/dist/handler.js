import { ALLOWED_ROUTES, DEFAULT_RATE_LIMIT, FORWARDED_REQUEST_HEADERS, FORWARDED_RESPONSE_HEADERS, MAX_REQUEST_BYTES, UPSTREAM_ORIGIN, UPSTREAM_TIMEOUT_MS, } from './policy.js';
export function createRelayHandler(options) {
    const upstream = options.upstreamOrigin ?? UPSTREAM_ORIGIN;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const limit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
    const now = options.now ?? (() => Date.now());
    const hits = new Map();
    const allowOrigin = (origin) => {
        if (!origin)
            return undefined;
        return options.allowedOrigins.includes(origin) ? origin : undefined;
    };
    const withinRate = (key) => {
        const at = now();
        const recent = (hits.get(key) ?? []).filter((stamp) => at - stamp < limit.windowMs);
        recent.push(at);
        hits.set(key, recent);
        // Bounded memory: drop idle buckets rather than growing forever.
        if (hits.size > 10_000) {
            for (const [bucket, stamps] of hits) {
                if (stamps.every((stamp) => at - stamp >= limit.windowMs))
                    hits.delete(bucket);
            }
        }
        return recent.length <= limit.max;
    };
    return async (request, response) => {
        const started = now();
        const origin = request.headers.origin;
        const permitted = allowOrigin(origin);
        const url = new URL(request.url ?? '/', 'http://relay.invalid');
        const path = url.pathname;
        const finish = (status, body, contentType = 'application/json') => {
            if (permitted) {
                response.setHeader('Access-Control-Allow-Origin', permitted);
                response.setHeader('Vary', 'Origin');
            }
            response.setHeader('Content-Type', contentType);
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('X-Content-Type-Options', 'nosniff');
            response.statusCode = status;
            response.end(body);
            options.log?.({ path, method: request.method ?? 'GET', status, durationMs: now() - started });
        };
        if (path === '/healthz') {
            finish(200, JSON.stringify({ ok: true }));
            return;
        }
        if (request.method === 'OPTIONS') {
            if (!permitted) {
                finish(403, JSON.stringify({ error: 'origin_not_allowed' }));
                return;
            }
            response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            response.setHeader('Access-Control-Allow-Headers', FORWARDED_REQUEST_HEADERS.join(', '));
            response.setHeader('Access-Control-Max-Age', '600');
            finish(204);
            return;
        }
        if (origin && !permitted) {
            finish(403, JSON.stringify({ error: 'origin_not_allowed' }));
            return;
        }
        const expectedMethod = ALLOWED_ROUTES.get(path);
        if (!expectedMethod) {
            // Deliberately identical for "unknown path" and "wrong method": the relay
            // does not help anyone map what Bybit exposes behind it.
            finish(404, JSON.stringify({ error: 'not_found' }));
            return;
        }
        if (request.method !== expectedMethod) {
            finish(404, JSON.stringify({ error: 'not_found' }));
            return;
        }
        let body;
        if (expectedMethod === 'POST') {
            try {
                body = await readBody(request, MAX_REQUEST_BYTES);
            }
            catch {
                // Answer first, close after. Destroying the socket on an oversized body
                // hands the client an ECONNRESET instead of a reason.
                response.setHeader('Connection', 'close');
                response.once('finish', () => request.destroy());
                finish(413, JSON.stringify({ error: 'payload_too_large' }));
                return;
            }
        }
        const rateKey = String(request.headers['x-bapi-api-key'] ?? request.socket.remoteAddress ?? '?');
        if (!withinRate(rateKey)) {
            finish(429, JSON.stringify({ error: 'rate_limited' }));
            return;
        }
        const headers = {};
        for (const name of FORWARDED_REQUEST_HEADERS) {
            const value = request.headers[name];
            if (typeof value === 'string')
                headers[name] = value;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
        try {
            const upstreamResponse = await fetchImpl(`${upstream}${path}${url.search}`, {
                method: expectedMethod,
                headers,
                ...(body === undefined ? {} : { body }),
                signal: controller.signal,
                redirect: 'error',
            });
            for (const name of FORWARDED_RESPONSE_HEADERS) {
                const value = upstreamResponse.headers.get(name);
                if (value)
                    response.setHeader(name, value);
            }
            const text = await upstreamResponse.text();
            finish(upstreamResponse.status, text, upstreamResponse.headers.get('content-type') ?? 'application/json');
        }
        catch {
            // The thrown value can carry the full request URL, and that URL carries
            // the signed query string. It is never surfaced or logged.
            finish(502, JSON.stringify({ error: 'upstream_unavailable' }));
        }
        finally {
            clearTimeout(timer);
        }
    };
}
function readBody(request, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        const onData = (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                settled = true;
                request.off('data', onData);
                // Stop reading, but leave the socket alive long enough to answer.
                request.pause();
                reject(new Error('payload too large'));
                return;
            }
            chunks.push(chunk);
        };
        request.on('data', onData);
        request.on('end', () => {
            if (!settled)
                resolve(Buffer.concat(chunks).toString('utf8'));
        });
        request.on('error', reject);
    });
}
