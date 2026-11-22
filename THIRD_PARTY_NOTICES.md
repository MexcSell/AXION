# Third-party notices

## Public Suffix List (MPL-2.0)
- What: the Public Suffix List, used to refuse grants for public suffixes (`server/src/grants/psl.ts`).
- Source: https://publicsuffix.org/list/public_suffix_list.dat (project: https://github.com/publicsuffix/list)
- List version `2026-11-21_04-33-45_UTC`, commit `87a2c1b8de5886a133ff4da21b2aa6fec88d8739`, fetched 2026-11-22.
- Licence: Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/). The file is stored unmodified, with its licence header intact, at `server/src/grants/public_suffix_list.dat`. Its size and SHA-256 are in `server/src/grants/public_suffix_list.manifest.json` and are checked at server start and in tests. If the file is ever changed, the changed file stays under MPL-2.0.

## Public Suffix List test vectors (CC0-1.0)
- What: the project's published `checkPublicSuffix` test vectors, used by `server/test/psl-vectors.test.ts`.
- Source: https://raw.githubusercontent.com/publicsuffix/list/master/tests/test_psl.txt
- Licence: CC0 1.0 Universal (public domain dedication); no conditions.
- Stored at: `server/test/fixtures/test_psl.txt`.

### OpenTelemetry GenAI semantic conventions (pages stored verbatim)
- Files: web/docs/improve/phase2/otel-spec-v0.1.0/gen-ai-agent-spans.md and execute-tool.md (unmodified copies)
- Author: The OpenTelemetry Authors
- Licence: Apache License 2.0 (full text: web/docs/improve/phase2/otel-spec-v0.1.0/LICENSE)
- Source: https://github.com/open-telemetry/semantic-conventions-genai, tag v0.1.0, commit d0e74ba6c48bcc4ded473b1828a8212f06b23753
