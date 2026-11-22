# c56 brief: pinned Public Suffix List (P4b)

**Lane:** w55 (`/home/luca/AXION-w55`, branch `c56-public-suffix`), from improve-30h at the commit that adds this brief. Ports 10590–10593. E2E DB **axion_e2e4** (reused). Migration only if needed (ask the controller for a number).
**Read first:** `cycles/c36-*` (site grants, origin normaliser), `server/src/grants/origin.ts`, LESSONS "Fail closed beats enumerating".

## Items
1. **Vendor a snapshot.** Fetch `https://publicsuffix.org/list/public_suffix_list.dat` once (plain GET, no identifying headers beyond a generic client name). Commit it under `server/src/grants/` with its MPL-2.0 header intact, plus a small manifest: fetch date, byte size and SHA-256. A test checks the file against the manifest hash, so a silent edit fails.
2. **Refuse public suffixes.** A grant whose registrable domain would be a public suffix (ICANN and PRIVATE sections, wildcards `*.` and exceptions `!` per the PSL algorithm) is refused with a named code. Replace c36's partial embedded list with the snapshot; every c36 test still passes.
3. **Algorithm tests.** Use the PSL's published test vectors (`tests/test_psl.txt` from the same project) where they apply to hostnames we accept; IDN entries stay refused per c36 (P4a is separate).
4. **UI.** The grant form's refusal message explains "public suffix" in plain words, with the `?` help.

## Pass threshold
- Items 1–4 RED → GREEN. Every c36 test still passes. Full vitest, tsc, api-c36 (or the site-grants check), stage6, a11y clean. Contract entries for any new code or field.

## Report
`cycles/c56-report.md`, with the snapshot date and hash.
