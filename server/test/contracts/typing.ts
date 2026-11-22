import { str, num, opt, openObj } from './validate.ts';
import type { MissionDto, AgentDto } from '../../../shared/contracts/src/index.ts';

/** tsc-level proof that `openObj` is tied to the DTO: if the typing loosens, a line below stops being an error and tsc fails on the unused directive. */
interface Idx { a: string; b?: number; [k: string]: unknown }
export const okShape = openObj<Idx>({ a: str, b: opt(num) });
// @ts-expect-error a named key without a validator must not compile
export const missing = openObj<Idx>({ a: str });
// @ts-expect-error a key the DTO does not name must not compile
export const extra = openObj<Idx>({ a: str, b: opt(num), c: str });
// @ts-expect-error a validator of the wrong type must not compile
export const wrong = openObj<Idx>({ a: num, b: opt(num) });

type MissionShape = Parameters<typeof openObj<MissionDto>>[0];
type AgentShape = Parameters<typeof openObj<AgentDto>>[0];
export const mk: keyof MissionShape = 'rowVersion';
export const ak: keyof AgentShape = 'rowVersion';
// @ts-expect-error the index signature is not a named key
export const nk: keyof MissionShape = 'somethingElse';
