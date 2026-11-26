# AXION front proxy (evolve step 1). Rendered by the Guard (evolve/guard/effects-docker.ts) into <root>/front/default.conf,
# which is mounted read-only at /etc/nginx/conf.d in the axion-front container (nginx:1.27-alpine). A switch rewrites the
# file atomically and runs `nginx -t` + `nginx -s reload`; never edit the rendered file by hand.
# {{SLOT}} is the slot container the site is served from (axion-blue or axion-green, on the axion-live network).
upstream axion_slot {
    server {{SLOT}}:4190;
    keepalive 16;
}

server {
    listen 8080;
    server_name _;
    server_tokens off;
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
