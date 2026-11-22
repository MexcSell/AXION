import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// c56 item 1: the vendored Public Suffix List snapshot is checked against its manifest, so a silent edit fails.
const dir = new URL('../src/grants/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('public_suffix_list.manifest.json', dir), 'utf8')) as {
  source: string; fetchedAt: string; licence: string; listVersion: string; listCommit: string;
  list: { file: string; bytes: number; sha256: string };
  vectors: { source: string; file: string; bytes: number; sha256: string };
};
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('public suffix list snapshot', () => {
  it('names its source, licence and fetch date', () => {
    expect(manifest.source).toBe('https://publicsuffix.org/list/public_suffix_list.dat');
    expect(manifest.licence).toBe('MPL-2.0');
    expect(manifest.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
  it('matches the manifest byte size and SHA-256', () => {
    const b = readFileSync(new URL(manifest.list.file, dir));
    expect(b.length).toBe(manifest.list.bytes);
    expect(sha(b)).toBe(manifest.list.sha256);
  });
  it('keeps the MPL-2.0 header and the version stamp intact', () => {
    const t = readFileSync(new URL(manifest.list.file, dir), 'utf8');
    expect(t.startsWith('// This Source Code Form is subject to the terms of the Mozilla Public\n// License, v. 2.0.')).toBe(true);
    expect(t).toContain('https://mozilla.org/MPL/2.0/');
    expect(t).toContain(`// VERSION: ${manifest.listVersion}`);
    expect(t).toContain(`// COMMIT: ${manifest.listCommit}`);
    expect(t).toContain('// ===BEGIN ICANN DOMAINS===');
    expect(t).toContain('// ===BEGIN PRIVATE DOMAINS===');
  });
  it('detects a silent edit (one changed byte changes the hash)', () => {
    const b = readFileSync(new URL(manifest.list.file, dir));
    const edited = Buffer.from(b); edited[edited.length - 2] ^= 1;
    expect(sha(edited)).not.toBe(manifest.list.sha256);
  });
  it('pins the published test vectors the same way', () => {
    const b = readFileSync(new URL('../../test/fixtures/test_psl.txt', dir));
    expect(manifest.vectors.file).toBe('server/test/fixtures/test_psl.txt');
    expect(b.length).toBe(manifest.vectors.bytes);
    expect(sha(b)).toBe(manifest.vectors.sha256);
  });
});
