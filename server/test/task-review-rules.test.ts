import { describe, it, expect } from 'vitest';
import { modelFamily, reviewerAgreement, type ReviewRef } from '../src/tasks/review-rules.ts';

describe('modelFamily (derived from the version model, never from the client)', () => {
  it.each([['claude-opus-5-5', 'claude'], ['claude-haiku-5-5', 'claude'], ['  Claude-Sonnet-5-5 ', 'claude'], ['gpt-4o', 'gpt'], ['whisper-large-v4', 'whisper'], ['translate-ja-en-v2', 'translate'], ['llama3.1', 'llama']])('%s -> %s', (m, f) => expect(modelFamily(m)).toBe(f));
  it.each([[''], ['   '], ['5-turbo'], [null], [undefined]])('%j has no family (unknown)', (m) => expect(modelFamily(m as never)).toBeNull());
});

const R = (taskId: string, reviewerKey: string, verdict: ReviewRef['verdict'], seq: number): ReviewRef => ({ taskId, reviewerKey, verdict, seq });
describe('reviewerAgreement', () => {
  it('3 of 4 agreements -> 0.75 with n=4, which is below 5: not enough evidence', () => {
    const rs = [
      R('T1', 'u:a', 'accepted', 1), R('T1', 'u:b', 'accepted', 2),
      R('T2', 'u:a', 'rejected', 3), R('T2', 'u:b', 'rejected', 4),
      R('T3', 'u:a', 'accepted', 5), R('T3', 'u:b', 'accepted', 6),
      R('T4', 'u:a', 'accepted', 7), R('T4', 'u:b', 'changes_requested', 8),
    ];
    expect(reviewerAgreement(rs).get('u:a')).toEqual({ agreed: 3, n: 4, rate: 0.75, state: 'none' });
    expect(reviewerAgreement(rs).get('u:b')).toEqual({ agreed: 0, n: 0, rate: null, state: 'none' }); // nothing came after b's reviews
  });
  it('5 comparable reviews are enough: 4 of 5 -> 0.8, state ok', () => {
    const rs: ReviewRef[] = [];
    for (let i = 0; i < 5; i++) rs.push(R('T' + i, 'u:a', 'accepted', i * 2 + 1), R('T' + i, 'u:b', i === 0 ? 'rejected' : 'accepted', i * 2 + 2));
    expect(reviewerAgreement(rs).get('u:a')).toEqual({ agreed: 4, n: 5, rate: 0.8, state: 'ok' });
  });
  it('the first later review by someone else counts; the reviewer\'s own later reviews are skipped', () => {
    const rs = [R('T', 'u:a', 'rejected', 1), R('T', 'u:a', 'accepted', 2), R('T', 'u:b', 'accepted', 3), R('T', 'u:c', 'rejected', 4)];
    const m = reviewerAgreement(rs);
    expect(m.get('u:a')).toEqual({ agreed: 1, n: 2, rate: 0.5, state: 'none' }); // seq1 vs b's accepted: no; seq2 vs b's accepted: yes
    expect(m.get('u:b')).toEqual({ agreed: 0, n: 1, rate: 0, state: 'none' });    // b accepted, c rejected
    expect(m.get('u:c')).toEqual({ agreed: 0, n: 0, rate: null, state: 'none' });
  });
  it('different tasks never mix; the order of the input does not matter; an agent and a user are different reviewers', () => {
    const rs = [R('T2', 'agent:x', 'accepted', 4), R('T1', 'u:a', 'accepted', 1), R('T2', 'u:a', 'accepted', 3), R('T1', 'agent:x', 'accepted', 2)];
    const m = reviewerAgreement(rs);
    expect(m.get('u:a')).toEqual({ agreed: 2, n: 2, rate: 1, state: 'none' });
    expect(m.get('agent:x')).toEqual({ agreed: 0, n: 0, rate: null, state: 'none' });
  });
  it('no reviews, no entries', () => expect(reviewerAgreement([]).size).toBe(0));
});
