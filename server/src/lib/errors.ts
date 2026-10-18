/* Every refusal the API makes, in the shape the pages read:

     { "error": { "code": "slot_taken", "message": "…" }, ...extra }

   The pages branch on `code` and the status, never on wording, so the
   message can be improved without breaking anything. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
  body() { return { error: { code: this.code, message: this.message }, ...(this.extra || {}) }; }
}

export const E = {
  validation: (errors: Record<string, string>, message = 'Some details need fixing.') =>
    new ApiError(422, 'validation', message, { errors }),
  notFound: (message = 'Not found.') => new ApiError(404, 'not_found', message),
  conflict: (code: string, message: string) => new ApiError(409, code, message),
  forbidden: (code: string, message: string) => new ApiError(403, code, message),
  unauthenticated: (loginUrl: string, code = 'unauthenticated', message = 'Sign in to continue.') =>
    new ApiError(401, code, message, { login_url: loginUrl }),
  gone: (code: string, message: string) => new ApiError(410, code, message),
  unavailable: (code: string, message: string) => new ApiError(503, code, message),
  rejected: () => new ApiError(400, 'rejected', 'Request rejected.')
};
