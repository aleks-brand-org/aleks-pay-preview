import { createServer } from 'node:http';
import { createRelayHandler } from './handler.js';
import { DEPLOYMENT_NOTE } from './policy.js';
/**
 * Entry point.
 *
 * Configuration is environment only — there is no config file, because there is
 * nothing to configure that is not deployment-specific, and a file would be one
 * more place a secret could end up. The relay has no secrets to hold.
 */
const port = Number(process.env.PORT ?? 8080);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
if (allowedOrigins.length === 0) {
    // Refusing to start beats starting as an open relay that anyone may call.
    process.stderr.write('ALLOWED_ORIGINS is empty. Set it to the origins that may use this relay, ' +
        'comma separated, e.g. https://pay.aleksishmanov.ru\n');
    process.exit(1);
}
const handler = createRelayHandler({
    allowedOrigins,
    log: (entry) => {
        // Path, method, status, duration. Nothing else exists to leak.
        process.stdout.write(`${entry.method} ${entry.path} ${entry.status} ${entry.durationMs}ms\n`);
    },
});
createServer((request, response) => {
    void handler(request, response).catch(() => {
        response.statusCode = 500;
        response.end('{"error":"internal"}');
    });
}).listen(port, () => {
    process.stdout.write(`relay listening on ${port}\n`);
    process.stdout.write(`allowed origins: ${allowedOrigins.join(', ')}\n`);
    process.stdout.write(`${DEPLOYMENT_NOTE}\n`);
});
