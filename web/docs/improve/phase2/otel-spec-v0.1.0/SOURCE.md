# Pinned OpenTelemetry GenAI semantic conventions (c60)

These two pages are verbatim copies (Apache-2.0, OpenTelemetry authors) of the public pages at
<https://github.com/open-telemetry/semantic-conventions-genai> tag `v0.1.0`, commit `d0e74ba6c48bcc4ded473b1828a8212f06b23753`
(published 2026-11-21). The GenAI conventions moved there from `open-telemetry/semantic-conventions`, where `docs/gen-ai/*.md` at v1.45.0 is
now only a "Moved" stub. Status of every page: **Development** (it may change without notice). Fetched 2026-11-22 with a generic HTTP client; nothing else was sent.

| File | Source path | SHA-256 |
|---|---|---|
| gen-ai-agent-spans.md | docs/gen-ai/gen-ai-agent-spans.md | 0d2db04dd642e52c73eadf7b05b3ae1586d6ab99462c94a9c31e5cebff0e01ff |
| execute-tool.md | docs/gen-ai/execute-tool.md | 7a72f0d602c6d023944d1e43f54caba53b4eeb2987ac46f6c272746d526d15f3 |

`server/test/otel-mapping.test.ts` re-hashes these files and re-parses their attribute tables, so an edit here fails the tests.
