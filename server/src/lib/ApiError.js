/**
 * Every error the API returns on purpose. `code` is a stable machine-readable
 * string the client switches on; `message` is for humans.
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(code, message, details) {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, code, message);
  }
  static forbidden(message = 'Not permitted', code = 'FORBIDDEN') {
    return new ApiError(403, code, message);
  }
  static notFound(message = 'Not found', code = 'NOT_FOUND') {
    return new ApiError(404, code, message);
  }
  static conflict(code, message, details) {
    return new ApiError(409, code, message, details);
  }
  /** 422 — the request was well-formed but a business rule rejected it. */
  static unprocessable(code, message, details) {
    return new ApiError(422, code, message, details);
  }
  static notImplemented(message = 'Not implemented yet') {
    return new ApiError(501, 'NOT_IMPLEMENTED', message);
  }
  static unavailable(code, message) {
    return new ApiError(503, code, message);
  }
}
