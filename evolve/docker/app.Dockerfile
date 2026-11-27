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
# /app is owned by root: the build runs as the Guard's worker user (R31: AXION_BUILD_UID/GID = axion-ws) and can write only
# web/dist and web/node_modules/.vite-temp, so candidate build code cannot rewrite tests, scripts or node_modules in the
# image it is then judged by.
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
# R31: the uid:gid the candidate's web build runs as: the Guard passes its worker user (axion-ws, a non-login system user,
# looked up at run time); never the image's node (uid 1000 is a login account on the host). Declared in this stage only, so
# the deps stage's cache is not affected. The default (65534 = nobody) resolves to no login account either.
ARG AXION_BUILD_UID=65534
ARG AXION_BUILD_GID=65534
# the repo tree (server/, web/, shared/, evolve/, ...); server tests read web/src, so everything not ignored comes in (root-owned)
COPY . .
# the only paths the build user can write: the web build output, and the dir vite bundles vite.config.ts into (vite preview
# writes it again at start, as the run-time uid: --user <axion uid>)
RUN rm -rf web/dist web/node_modules/.vite-temp \
 && mkdir web/dist web/node_modules/.vite-temp \
 && chown "$AXION_BUILD_UID:$AXION_BUILD_GID" web/dist && chmod 1777 web/node_modules/.vite-temp
USER ${AXION_BUILD_UID}:${AXION_BUILD_GID}
# HOME: the build uid has no passwd entry in the image (npm's cache and logs go to the world-writable /tmp)
RUN cd web && HOME=/tmp npm run build
# a neutral default user (nobody); every container of this image is started with --user (slots, boot, migrate: axion;
# the runner's typecheck: axion-ws; the mission CLI: axion)
USER 65534:65534

# last, so a new commit never invalidates the layers above
ARG AXION_COMMIT
ENV AXION_COMMIT=$AXION_COMMIT

EXPOSE 4190
CMD ["node", "evolve/slot/entry.mjs"]
