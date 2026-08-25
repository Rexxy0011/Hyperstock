import axios from 'axios';

/**
 * The one HTTP client.
 *
 * `withCredentials` matters: the refresh token lives in an httpOnly cookie, and
 * in dev the Vite proxy makes /api same-origin so it travels without any CORS
 * credential dance.
 */
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15_000,
});

/* ------------------------------------------------------------------ tokens */

// Held in memory only, never localStorage — an XSS then cannot exfiltrate it.
let accessToken = null;

export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

/* ------------------------------------------------- single-flight refresh */

/**
 * The Portfolio screen fires several queries on mount. Without single-flight,
 * simultaneous 401s would each POST /auth/refresh, and because refresh tokens
 * rotate on use, the later ones would present an already-consumed token and
 * log the user out. All concurrent 401s share one refresh promise instead.
 */
let refreshPromise = null;

function refreshOnce() {
  refreshPromise ??= api
    .post('/auth/refresh')
    .then((res) => {
      setAccessToken(res.data.accessToken);
      return res.data.accessToken;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { response, config } = error;

    const isAuthCall = config?.url?.includes('/auth/refresh') || config?.url?.includes('/auth/login');
    if (response?.status !== 401 || config?._retried || isAuthCall) {
      return Promise.reject(normalizeError(error));
    }

    try {
      await refreshOnce();
      config._retried = true;
      return api(config);
    } catch {
      setAccessToken(null);
      return Promise.reject(normalizeError(error));
    }
  },
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
  const payload = error.response?.data?.error;

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
