/**
 * What the relay is allowed to do.
 *
 * The relay exists for one reason: Bybit's API sends no CORS headers, so a
 * browser cannot read its responses (ADR 0003). A first-party backend calling
 * an API on behalf of its own signed-in user is ordinary architecture — but
 * this particular backend sits in the path of a user's financial data, so its
 * job is defined by what it refuses, not by what it forwards.
 *
 * It never holds a credential. The browser signs the request; the relay copies
 * bytes. A signature is bound to a timestamp and a recv-window, so a captured
 * request expires in seconds, and the key behind it is read-only by
 * construction — the permission gate refused to store anything else.
 *
 * **Non-goal: this is not a way around Bybit's regional restrictions.** Bybit
 * closes some jurisdictions deliberately, and routing a blocked user's traffic
 * through a permitted one is not something this component is for. The region
 * requirement below exists so the service can reach its upstream at all, which
 * is an operational fact about running it, not a feature offered to users.
 */
export const UPSTREAM_ORIGIN = 'https://api.bybit.com';
/**
 * Paths the relay will forward, and the method each accepts.
 *
 * An allowlist, not a pattern. A relay that forwards `/v5/*` is an open proxy
 * to Bybit for anyone who finds its URL, and would carry a withdrawal request
 * signed with somebody else's key just as happily as a read.
 */
export const ALLOWED_ROUTES = new Map([
    ['/v5/market/time', 'GET'],
    ['/v5/user/query-api', 'GET'],
    ['/v5/card/transaction/query-asset-records', 'POST'],
]);
/**
 * Request headers copied upstream.
 *
 * Everything else is dropped — cookies and `Authorization` above all. Bybit
 * authenticates by signature, so nothing ambient should travel with a request.
 */
export const FORWARDED_REQUEST_HEADERS = [
    'x-bapi-api-key',
    'x-bapi-timestamp',
    'x-bapi-recv-window',
    'x-bapi-sign',
    'content-type',
];
/** Response headers copied back. The browser needs no more than this. */
export const FORWARDED_RESPONSE_HEADERS = ['content-type'];
/** Bodies here are small JSON documents; anything larger is not ours. */
export const MAX_REQUEST_BYTES = 16 * 1024;
export const UPSTREAM_TIMEOUT_MS = 20_000;
export const DEFAULT_RATE_LIMIT = { windowMs: 60_000, max: 60 };
/**
 * Operational note for whoever deploys this.
 *
 * The service must be able to reach `api.bybit.com` itself, or it cannot do its
 * job. Render's US regions cannot; Frankfurt and Singapore can.
 */
export const DEPLOYMENT_NOTE = 'The relay must be able to reach api.bybit.com from wherever it runs. On Render that means Frankfurt or Singapore.';
