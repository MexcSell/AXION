# AXION front proxy (evolve step 1). Rendered by the Guard (evolve/guard/effects-docker.ts) into <root>/front/default.conf,
# which is mounted read-only at /etc/nginx/conf.d in the axion-front container (nginx:1.27-alpine). A switch rewrites the
# file atomically and runs `nginx -t` + `nginx -s reload`; never edit the rendered file by hand.
# {{SLOT}} is the slot container the site is served from (axion-blue or axion-green, on the axion-live network).
# The slot's name is re-resolved through Docker's DNS (127.0.0.11) every 10 s (`resolve`, nginx >= 1.27.3; the image
# nginx:1.27-alpine is 1.27.5): a slot restarted with a new IP keeps being reached, and the front starts even while the
# slot is not up yet (e.g. after a reboot).
resolver 127.0.0.11 valid=10s ipv6=off;
resolver_timeout 5s;

# One JSON line per request on stdout (docker logs), read by the Guard's watch (front5xx in effects-docker.ts): the status
# first, the slot this config routes to baked in (so requests finishing on the retiring slot during a switch are not
# counted against the new one), client-controlled fields last and JSON-escaped. The path only, never the query string.
log_format axion_guard escape=json '{"status":$status,"slot":"{{SLOT}}","time":"$time_iso8601","upstream_status":"$upstream_status","request_time":$request_time,"method":"$request_method","uri":"$uri"}';

upstream axion_slot {
    zone axion_slot 64k;
    server {{SLOT}}:4190 resolve;
    keepalive 16;
}

server {
    listen 8080;
    server_name _;
    server_tokens off;
    access_log /dev/stdout axion_guard;
    # uploads: the API accepts files up to 25 MB (multipart limit in server/src/app.ts)
    client_max_body_size 30m;

    location / {
        proxy_pass http://axion_slot;
        proxy_http_version 1.1;
        # keepalive to the slot (no "Connection: close" forwarded)
        proxy_set_header Connection "";
        # the browser's Host, so vite preview and the API see the address the user typed
        proxy_set_header Host $http_host;
        # the event stream (SSE) must reach the browser at once and may stay open for long
        proxy_buffering off;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
