# AXION app image (evolve step 1): one image per commit, run as a slot with `node evolve/slot/entry.mjs`.
# Build from the repo root: docker build -f evolve/docker/app.Dockerfile --build-arg AXION_COMMIT=$(git rev-parse HEAD) -t axion-app:dev .
# No .env and no data ever enter the image (.dockerignore); the slot gets its settings from the environment at run time.
FROM node:24-bookworm-slim

# curl/iproute2 (ss)/procps for health checks and the browser-check script; git for the contract test that diffs against a base commit
# (the repository's git dir is mounted read-only at run time, never copied in). safe.directory: that mount is owned by another uid.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl iproute2 procps git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'

WORKDIR /app
RUN chown node:node /app
USER node

# dependency layers: cached on package*.json only
COPY --chown=node:node server/package.json server/package-lock.json server/
RUN cd server && npm ci --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund && npm cache clean --force

# the repo tree (server/, web/, shared/, evolve/, ...); server tests read web/src, so everything not ignored comes in
COPY --chown=node:node . .
# vite preview bundles vite.config.ts into web/node_modules/.vite-temp at start: writable for any run-time uid (--user <axion uid>)
RUN cd web && npm run build \
 && mkdir -p node_modules/.vite-temp && chmod 1777 node_modules/.vite-temp

# last, so a new commit never invalidates the layers above
ARG AXION_COMMIT
ENV AXION_COMMIT=$AXION_COMMIT

# USER node is replaced at run time by --user <axion uid>
EXPOSE 4190
CMD ["node", "evolve/slot/entry.mjs"]
