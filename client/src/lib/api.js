import axios from 'axios';

/**
 * The one HTTP client.
 *
 * `withCredentials` matters: the session lives in an httpOnly cookie, and in dev
 * the Vite proxy is `changeOrigin: false`, so /api is same-origin and the cookie
 * travels without any CORS credential dance.
 */
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15_000,
});

/* --------------------------------------------------------------- sessions */

/**
 * THERE IS NO ACCESS TOKEN ANY MORE, AND NO REFRESH DANCE. Better Auth keeps
 * the session in an httpOnly cookie the browser attaches on its own, so the
 * request interceptor that carried a Bearer header and the single-flight
 * refresh that guarded against concurrent rotation are both gone.
 *
 * That single-flight existed for a real problem: the Portfolio screen fires
 * several queries on mount, refresh tokens rotated on use, and simultaneous
 * 401s would each spend the same token — the later ones presenting one already
 * consumed and signing the user out. A cookie the browser manages cannot race
 * with itself that way, so the whole mechanism has nothing left to protect.
 *
 * One consequence worth stating: the token used to live in memory only, so an
 * XSS could not exfiltrate it. An httpOnly cookie is stronger on exactly that
 * axis — script cannot read it at all — but it is sent automatically, so CSRF
 * becomes the exposure the memory token did not have. Better Auth's cookie is
 * SameSite=Lax, which is what covers it for the cross-site form-post case.
 */
api.interceptors.response.use(
  (res) => res,
  (error) => Promise.reject(normalizeError(error)),
);

/**
 * The client-side shape of a server error.
 *
 * A real subclass rather than properties bolted onto a plain Error, so `code`
 * and `status` are part of the type and callers can switch on them safely —
 * e.g. PRICE_MOVED on a trade, or INSUFFICIENT_FUNDS.
 */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, details?: unknown }} [meta]
   */
  constructor(message, { code, status, details } = {}) {
    super(message);
    this.name = 'ApiError';
    /** @type {string | undefined} */
    this.code = code;
    /** @type {number | undefined} */
    this.status = status;
    this.details = details;
  }
}

/** Flattens the server's `{error:{code,message}}` envelope into an ApiError. */
function normalizeError(error) {
  const data = error.response?.data;
  /**
   * TWO ENVELOPES REACH THIS NOW. The app's own routes return
   * `{ error: { code, message } }` via `ApiError`; Better Auth returns a FLAT
   * `{ code, message }` from `/api/auth/*` and knows nothing about ours.
   *
   * Both are accepted here rather than translated at the boundary, because the
   * client contract is that `code` IS the translation key — so an unwrapped
   * `INVALID_EMAIL_OR_PASSWORD` lands in `errors.*` exactly like a wrapped
   * `BAD_CREDENTIALS` does, and neither leaks a raw code to the reader.
   */
  const payload = data?.error ?? (data?.code || data?.message ? data : null);

  if (!payload) {
    /**
     * NO RESPONSE AT ALL — the server is unreachable, the request was blocked,
     * or DNS failed. Axios calls that "Network Error", and left alone that
     * string is what a user reads: untranslated, capitalised like a class name,
     * and describing the transport rather than what they should do about it.
     *
     * It gets a `code` here so it travels the same path as every server error:
     * the code IS the translation key, so `errors.NETWORK_ERROR` renders in the
     * reader's own language like the rest of them. A response that arrived but
     * carried no envelope keeps its status, since a bare 502 from a proxy is a
     * different thing from never reaching one.
     */
    if (!error.response) {
      return new ApiError(error.message ?? 'Network error', { code: 'NETWORK_ERROR' });
    }
    return new ApiError(error.message ?? 'Request failed', {
      code: 'SERVER_ERROR',
      status: error.response.status,
    });
  }

  return new ApiError(payload.message ?? 'Request failed', {
    code: payload.code,
    status: error.response.status,
    details: payload.details,
  });
}

/* ----------------------------------------------------------- thin helpers */

export const get = (url, config) => api.get(url, config).then((r) => r.data);
export const post = (url, body, config) => api.post(url, body, config).then((r) => r.data);
export const patch = (url, body, config) => api.patch(url, body, config).then((r) => r.data);
export const del = (url, config) => api.delete(url, config).then((r) => r.data);
