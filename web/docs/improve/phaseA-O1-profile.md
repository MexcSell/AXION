# O1: the safety file for one kind of work, in plain words

Date: 2026-11-25. Phase A. This page is for you, the owner. Two small files sit next to it:

- `phaseA-O1-profile.json`: what the work may touch (the "execution profile").
- `phaseA-O1-caps.json`: how much of it may happen (the "caps").

**Nothing uses this file yet.** No agent runs, no browser opens, no model is called. The file is a proposal. The server can check it and judge requests against it on paper; it cannot enforce anything until a sandbox exists (a later phase). If you say yes, the file is only approved as the one to build that sandbox from.

## The kind of work

"Read-only web browsing": an agent reads public pages on sites you have already granted, and writes nothing to the sites. It does not type, click buttons that send things, log in or submit forms. The pages it reads are untrusted (anyone could have written them), so the file puts the work in a container, not in the weakest sandbox.

## What it allows

- Reading pages on the **origins you list** (see "The one thing I need from you" below). Today the list is empty, so today it allows no site at all.
- Reading files in `/work/in` (input you give it).
- Writing files in `/work/scratch` only (a temporary folder for the browser's own cache).

## What it refuses

- Every site that is not on the list, every address that is a number instead of a name (such as `https://10.0.0.1/`), and plain `http://`.
- Any page that sends the agent on to a private, local or cloud-metadata address (for example `169.254.169.254`), even if the first page was allowed.
- Writing anywhere except `/work/scratch`, and writing to `/work/in`.
- Reading or writing secrets: `.env` files, `.ssh` keys, cloud credential files, `.pem` files, `.netrc`, `.npmrc`, and the like.
- Paths that try to climb out of the allowed folders (`../`).
- Using more than the limits below.

## The limits

Per run, the work stops the moment one of these is reached (it stops, it does not retry):

| Limit | Value |
|---|---|
| Steps (tool calls) per run | 40 |
| Time per run | 10 minutes |
| Tool calls per minute | 20 |
| Different sites per run | 3 |
| Money reserved for a run | 0 (no model is called in this phase; the real figure is decision O3) |
| Tokens reserved for a run | 0 (same) |
| Three failed steps in a row | stops the run |
| Memory / CPU / processes inside the container | 1024 MB / 2000 CPU millis (about 2 cores, my reading of the c94 unit) / 256 processes |

It starts at stage 1: the agent only proposes, a person compares, nothing runs on its own.

## The fingerprint

The profile has this fingerprint (SHA-256): `616cfcc10de8e18eabfee30ed52be33522b9aa1730190a3ce95d4d95cd4f9138`.

If any word of the profile changes, for example when you add an origin, the fingerprint changes. That is the point: with the digest change in O1b below, an approval would be tied to this exact fingerprint and these exact caps, so changing either afterwards makes the approval stale and a new one is needed. The test `server/test/phaseA-o1-profile.test.ts` fails if this page and the file drift apart.

## The one thing I need from you

I could not read your live Site Grants (I never sign in or touch the live database), and I did not want to guess. So **the list of sites is empty on purpose.** When you decide O1, name the origins from your Site Grants screen that this kind of work may read, one per line, each already granted (exact origin: `https://name` with a port only if it is not the usual one, no stars). I will put them in the file and compute the new fingerprint. A list of three or fewer matches the "3 different sites per run" limit.

## The decisions open now

- **O1: approve this profile and caps** (with the origins you name) as the safety file for "read-only web browsing". Your options: approve as it is, approve with changes (different limits, a stronger container tier), or say no.
- **O1b: approve the approval-digest change ("digest v3").** Today an approval is tied to the action, the person who asked, the tier and the expiry. Digest v3 also ties it to the profile fingerprint and the caps. It is built and tested but **off**: it turns on only when the server is started with `APPROVAL_DIGEST_VERSION=3`. Existing approvals keep working exactly as before. If you say yes, I turn it on when the first run is about to exist, not earlier. If you say no, approvals stay as they are and the caps/profile are checked but not bound.

Neither decision starts anything running. The decisions that come after (the first model call, its provider and budget) are O2 and O3 and are not asked yet.
