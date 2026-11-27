# AXION checks image (evolve step 1): the candidate's tree on the lockfile dependencies, plus Playwright Chromium for the
# browser checks. Built by the Guard (effects-docker.ts build(); legacy builder) in two runs, after the app image:
#   1. with network:  docker build -f evolve/docker/checks.Dockerfile --target browsers --build-arg DEPS_IMAGE=<p>-build:<tag>-deps
#                       -t <p>-build:<tag>-browsers .
#      Playwright's Chromium (+ its OS libraries) on the deps image: no candidate file is in the image yet.
#   2. no network:    docker build --network none -f evolve/docker/checks.Dockerfile --build-arg DEPS_IMAGE=… --build-arg APP_IMAGE=<p>-app:<tag>
#                       --build-arg AXION_COMMIT=<sha> -t <p>-checks:<tag> .
# Everything under /app is owned by root. The checks container runs as the Guard's worker user (axion-ws), read-only (`--read-only`, tmpfs /tmp, bind /out) with
# the Guard's own run-checks.sh mounted at /guard/run-checks.sh: the paths the suite writes inside /app are links into /tmp.
ARG DEPS_IMAGE=axion-build:deps
ARG APP_IMAGE=axion-app:dev

FROM ${DEPS_IMAGE} AS browsers
USER root
# a world-readable browser dir, so any run-time uid can launch it; --with-deps installs Chromium's OS libraries
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN cd web && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rX /ms-playwright

FROM ${APP_IMAGE} AS app

FROM browsers
# R31: the checks run as the Guard's worker user (axion-ws; its uid:gid is passed by the Guard, looked up at run time). It
# gets a passwd entry here (no login shell) so os.userInfo() works for the suite (audit-anchor tests); before the
# candidate's files, so the layer is shared by every build with the same uid. The default 65534 (nobody) exists already.
ARG AXION_BUILD_UID=65534
ARG AXION_BUILD_GID=65534
RUN getent passwd "$AXION_BUILD_UID" >/dev/null \
 || echo "axion-ws:x:$AXION_BUILD_UID:$AXION_BUILD_GID:AXION checks:/tmp/axion-checks/home:/usr/sbin/nologin" >> /etc/passwd
# the candidate tree (root-owned) and the web build from its app image; node_modules stay the lockfile ones of the deps stage
COPY . .
COPY --from=app /app/web/dist web/dist
# what the suite writes inside /app goes to /tmp (a tmpfs in the checks container), through links made here; the list is
# what a writable run wrote (docker diff, fix wave): the test-only .env written by run-checks.sh, the test uploads
# (server/data), vite's dep-optimizer cache and config bundles, vitest's caches. run-checks.sh creates the targets.
RUN rm -rf server/.env server/data server/node_modules/.vite server/node_modules/.vite-temp server/node_modules/.vitest-cache \
      web/node_modules/.vite web/node_modules/.vite-temp \
 && ln -s /tmp/axion-checks/test.env server/.env \
 && ln -s /tmp/axion-checks/server-data server/data \
 && ln -s /tmp/axion-checks/server-vite server/node_modules/.vite \
 && ln -s /tmp/axion-checks/server-vite-temp server/node_modules/.vite-temp \
 && ln -s /tmp/axion-checks/server-vitest-cache server/node_modules/.vitest-cache \
 && ln -s /tmp/axion-checks/web-vite web/node_modules/.vite \
 && ln -s /tmp/axion-checks/web-vite-temp web/node_modules/.vite-temp \
 && chown -R root:root web/dist

ARG AXION_COMMIT
ENV AXION_COMMIT=$AXION_COMMIT
# a neutral default (nobody); the Guard always runs the checks with --user <axion-ws uid:gid> (R31: never node = uid 1000,
# a login account on the host)
USER 65534:65534
CMD ["bash", "/guard/run-checks.sh"]
