# Relay — temporary

A built copy of `apps/relay` from the private repository, published so it can be
deployed while the direct browser path to `api.bybit.com` is being investigated
(ADR 0003).

It holds no credential. The caller signs; this copies bytes to three allowlisted
Bybit paths and back. It logs path, method, status and duration — no bodies, no
headers, no query strings.

Delete it, and the Render service with it, once the connection question is
settled.
