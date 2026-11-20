import type { ErrorCode } from '../../shared/contracts/src/index.ts';

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    public status: number,
    message: string,
    public opts: { retryable?: boolean; fieldErrors?: Record<string, string> } = {},
  ) { super(message); }
}
export const notFound = (what = 'Not found.') => new ApiError('NOT_FOUND', 404, what);
export const forbidden = (msg = 'You are not allowed to do this.') => new ApiError('FORBIDDEN', 403, msg);
export const badRequest = (msg: string, fieldErrors?: Record<string, string>) => new ApiError('VALIDATION', 400, msg, { fieldErrors });
