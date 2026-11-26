# AXION app image (evolve step 1): one image per commit, run as a slot with `node evolve/slot/entry.mjs`.
# No .env and no data ever enter the image (.dockerignore); the slot gets its settings from the environment at run time.
#
# Built in two `docker build` runs by the Guard (effects-docker.ts build(); legacy builder, DOCKER_BUILDKIT=0):
#   1. with network:  docker build -f evolve/docker/app.Dockerfile --target deps -t <p>-build:<tag>-deps .
#      Only the base image, OS packages, the pinned Claude CLI and the lockfile installs: no candidate file is in the
#      image yet, so no candidate code runs while there is a network.
#   2. no network:    docker build --network none -f evolve/docker/app.Dockerfile --build-arg AXION_COMMIT=<sha> -t <p>-app:<tag> .
#      The deps stage comes from run 1's cache (a cache miss fails closed: npm ci has no network). The candidate tree is
#      copied in and the web build (which runs the candidate's vite.config.ts) runs without any network.
# /app is owned by root: the build runs as node and can write only web/dist and web/node_modules/.vite-temp, so candidate
# build code cannot rewrite tests, scripts or node_modules in the image it is then judged by.
FROM node:24-bookworm-slim AS deps

# curl/iproute2 (ss)/procps for health checks and the browser-check script; git for the contract test that diffs against a base commit
# (the repository's git dir is mounted read-only at run time, never copied in). safe.directory: that mount is owned by another uid.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl iproute2 procps git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'
# the chat model runs the Claude CLI (server/src/cloud/claude-cli.ts finds `claude` on PATH); pinned to the host's version
# (found missing in the T8 dry run: without it the live slot has no cloud model and the GM chat never answers)
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code@2.1.325 && npm cache clean --force && claude --version

WORKDIR /app

# dependency layers (root-owned): cached on package*.json only
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --no-audit --no-fund && npm cache clean --force
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci --no-audit --no-fund && npm cache clean --force

FROM deps
# the repo tree (server/, web/, shared/, evolve/, ...); server tests read web/src, so everything not ignored comes in (root-owned)
COPY . .
# the only paths the build user can write: the web build output, and the dir vite bundles vite.config.ts into (vite preview
# writes it again at start, as the run-time uid: --user <axion uid>)
RUN rm -rf web/dist web/node_modules/.vite-temp \
 && mkdir web/dist web/node_modules/.vite-temp \
 && chown node:node web/dist && chmod 1777 web/node_modules/.vite-temp
USER node
RUN cd web && npm run build

# last, so a new commit never invalidates the layers above
ARG AXION_COMMIT
ENV AXION_COMMIT=$AXION_COMMIT

# USER node is replaced at run time by --user <axion uid>
EXPOSE 4190
CMD ["node", "evolve/slot/entry.mjs"]
