# AXION Workshop image (evolution step 2): where the engineer and reviewer agents run the Claude CLI.
# Built by install.sh (tag axion-workshop:<guard sha12>) from the Guard's trusted copy; the legacy builder (no BuildKit syntax).
# The container gets only its exported tree at /work (never a git directory, the Docker socket, the DB or another host mount),
# runs as the non-login system user axion-ws (R31: its uid:gid is looked up at run time and always passed with --user; the
# image bakes no uid, its default is nobody) read-only with tmpfs /tmp and HOME=/home/w, on the internal network
# axion-workshop whose only way out is the egress proxy (api.anthropic.com:443). The CLI has no Bash: tools are Read,Edit,Write,Glob,Grep (engineer) or none (reviewer).
FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code@2.1.325 \
 && npm cache clean --force \
 && claude --version
ENV DISABLE_AUTOUPDATER=1 \
    DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1 \
    USE_BUILTIN_RIPGREP=0 \
    HOME=/home/w
WORKDIR /work
# neutral default only (nobody); the runner always passes --user <axion-ws uid:gid>
USER 65534:65534
