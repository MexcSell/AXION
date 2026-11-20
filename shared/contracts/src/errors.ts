/** Error envelope shared by the API and the web client (spec §11). */
export const ERROR_CODES = [
  'BAD_REQUEST', 'VALIDATION', 'NOT_FOUND', 'UNAUTHENTICATED', 'SESSION_REVOKED', 'WRONG_PASSWORD',
  'USER_DISABLED', 'USER_REJECTED', 'DEVICE_BLOCKED', 'FORBIDDEN', 'CSRF', 'RATE_LIMITED',
  'ILLEGAL_TRANSITION', 'ACTION_NOT_ALLOWED', 'MISSION_REVISION_CONFLICT', 'PRECONDITION_REQUIRED',
  'IDEMPOTENCY_MISMATCH', 'IDEMPOTENCY_KEY_REQUIRED', 'APPROVAL_STALE', 'APPROVAL_ALREADY_DECIDED',
  'UPLOAD_REJECTED', 'NAME_TAKEN', 'LAST_ADMIN', 'CONFLICT', 'INTERNAL', 'UNAVAILABLE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorEnvelope {
  code: ErrorCode;
  message: string;
  correlationId: string;
  retryable: boolean;
  fieldErrors?: Record<string, string>;
}
