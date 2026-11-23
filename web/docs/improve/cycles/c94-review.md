# c94 review (362ced9..360de7a)
Verdict: NOT CLEAR (one major, fix is small). tsc clean; 4 c94 files, 508 tests pass.

1. MAJOR. Profile TOCTOU via accessors. validator.ts validates `input`, then returns `JSON.parse(JSON.stringify(input))`: a second read. Probe: `network.allowedOrigins` getter returning good.com for 3 reads, then evil.com. validateExecProfile ok:true, returned profile allows only evil.com; decideUrl({url:'https://evil.com'}) = ALLOW. Requests are accessor-hardened (plain()), profiles are not. Fix: clone first (structuredClone/JSON, catch -> refuse), validate the clone, return the clone; add accessor/proxy profile tests.
2. MAJOR (DoS). globToRegExp: each `**/` becomes `(?:.*/)?`. A profile forbiddenPattern `**/` x k + `zz` (<=200 chars) is accepted by the validator; decidePath on a 30-segment path: k=6 13ms, k=8 380ms, k=60 hangs (exponential), blocking the event loop. Builtin patterns on 4096-char paths are fine (<=5ms). Fix: collapse consecutive `**/` and cap `**` count per pattern (<=3), or match by segment without backtracking; refuse in the validator (bad_pattern).
3. MINOR. Sensitive scopes accepted: readOnlyPaths `/etc`, `/proc`, `/root` validate OK. With `/proc` scope, `/proc/self/root/etc/shadow` is not matched by anchored `/etc/shadow` and would be allowed (`/etc/ssh/ssh_host_*_key` likewise under `/etc`). Fix: refuse scopes at/above /etc, /proc, /sys, /dev, /root, /var/run (path_too_broad), or deny those prefixes in decidePath.
4. MINOR. Credential directory itself allowed: `/work/out/.ssh`, `.aws`, `.kube` (patterns are `**/.ssh/**`; `/**` needs a child) return allow. Fix: `**/.ssh{,/**}` style, or also test path+'/'.
5. MINOR. Windows-style credential spellings allowed: `/work/out/.env ` (trailing space), `.env::$DATA`. Fine on Linux; note as out of scope or deny trailing space/dot/`:`.
6. MINOR. Labelling: `http://127.0.0.1/` as a redirect hop gives redirect_not_granted, not redirect_internal (scheme checked first). Deny is right; the audit tag loses the internal signal. Fix: classify the host of non-https hops.

Checked and OK:
- URL differentials. All denied with sane codes: userinfo, backslash, tab/newline, %2e in host, empty port, `:0443`, trailing dot, `localhost.`, punycode/IDN, ideographic dot, fullwidth slash, `0x7f.1`, `127.1`, decimal, `[::ffff:127.0.0.1]`, zone id, 0.0.0.0, metadata names, leading and trailing space, mixed-case scheme (allowed, correct). Explicit `:443` is allowed as the same origin (correct). `:8443` gives port_mismatch. Redirect chains: scheme downgrade, internal hop, relative, `javascript:`, non-string hop, more than 10 hops and a non-array all denied.
- Path differentials. All denied: `..`, `//..`, `%2f`, `%2e`, backslash, NUL, ZWSP, `.ENV`, `.Env.local`, `ID_RSA.pub`, `.PEM`, `/proc/self/environ`, `/etc//shadow`, `/ETC/SHADOW`. Unicode lookalikes (`.énv`, fullwidth `．env`) are allowed but are different files on Linux.
- Profile tricks. All refused: permissive default, wildcard in the list, `__proto__` (JSON-parsed and defineProperty), nested unknown keys, untrusted+process, string-typed flag, zero/NaN/float/huge limits, 0.0.0.0/0 blocked-range.
- Reuse. Reuses `normaliseOrigin` (validator) and `originOfUrl` -> `normaliseOrigin` (decider); the only new function is `urlWithinGrantedOrigins`; no second parser. Its extra tail-character check is a filter, not parsing.
- Case-insensitive host (`GOOD.com` allowed): correct. The normaliser lowercases, and Kelvin/fullwidth lookalikes are denied. Documented.
- The 4 changed expected reasons (9b030a1/3290eee): all deny->deny code relabels (trailing dot, `%25` zone id, wrong-scheme hop, relative path). Honest; no allow/deny flipped. Item 6 is a minor relabelling cost.
- Fail-closed. Nothing throws on my probes; requests and items are strict. Exception: finding 1 for profiles.
- Tests. The claims hold: 192 own fixtures plus 169 reused hostile-origins entries, with a count floor. The DNS-spy test is weak, but the static import check backs it up.
- c92-script-base failure (`c82-pixel.mjs:7`). I did not run full vitest. The branch touches no web/ or scripts file (diff stat), so it is unrelated by inspection. Consistent with the known merge interaction.

## Scoped re-review of the fix round (360de7a..db0995f): CLEAR

All of findings 1–5 are resolved, and there is no regression: 544/544 c94 tests pass, including the original 508.

**1. TOCTOU (major): resolved.**
- `validate(snapshot(input))` reads the input once, and the return value is the snapshot.
- These are all refused: a getter on an object or an array index, `toJSON`, Array subclasses, Proxies, symbol keys, String objects and BigInt.
- The depth limit is exact: depth 6 is allowed and depth 7 refused.

**2. ReDoS (major): resolved.**
- Worst cases within the caps take at most 1.2 ms on a 4096-character path.
- A differential run against the old regex, over 300k random pattern and path pairs, found 0 differences.
- The cap boundaries are exact.

**3–5. Minors: resolved.**
- `/`, `/etc`, `/proc`, `/root`, `/sys` and `/dev` are refused at any depth, while `/etcetera` and `/rooted` are allowed.
- Credential directories are denied, with or without a trailing slash.
- Internal redirect hops are tagged `redirect_internal`.

**New notes (not blocking):**
- (a) `/var/run` is still accepted as a scope.
- (b) A hostile profile (32 patterns of 128 characters each) costs about 36 ms per path on 4096-character paths. A request of 1000 items could take about 36 s, so cap the items per request.
- (c) A U+0130 character in a pattern never matches. The built-in patterns are ASCII, so this has no practical effect.
