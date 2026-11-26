# AXION checks image (evolve step 1): the app image plus Playwright 1.56 Chromium for the browser checks.
# docker build -f evolve/docker/checks.Dockerfile --build-arg APP_IMAGE=axion-app:dev -t axion-checks:dev .
# Runs on an --internal Docker network only (no internet): bash evolve/slot/run-checks.sh
ARG APP_IMAGE=axion-app:dev
FROM ${APP_IMAGE}

USER root
# a world-readable browser dir, so any run-time uid can launch it; --with-deps installs Chromium's OS libraries
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN cd web && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rX /ms-playwright
USER node

CMD ["bash", "evolve/slot/run-checks.sh"]
