# AXION checks image (evolve step 1): the candidate's tree on the lockfile dependencies, plus Playwright Chromium for the
# browser checks. Built by the Guard (effects-docker.ts build(); legacy builder) in two runs, after the app image:
#   1. with network:  docker build -f evolve/docker/checks.Dockerfile --target browsers --build-arg DEPS_IMAGE=<p>-build:<tag>-deps
#                       -t <p>-build:<tag>-browsers .
#      Playwright's Chromium (+ its OS libraries) on the deps image: no candidate file is in the image yet.
#   2. no network:    docker build --network none -f evolve/docker/checks.Dockerfile --build-arg DEPS_IMAGE=… --build-arg APP_IMAGE=<p>-app:<tag>
#                       --build-arg AXION_COMMIT=<sha> -t <p>-checks:<tag> .
# Everything under /app is owned by root. The checks container runs read-only (`--read-only`, tmpfs /tmp, bind /out) with
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
USER node
CMD ["bash", "/guard/run-checks.sh"]
