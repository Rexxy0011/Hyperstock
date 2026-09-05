import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, post } from "../lib/api";

const AuthContext = createContext(null);

/**
 * Better Auth's session user, shaped the way this app already reads a user.
 *
 * `avatarLetter` was a Mongoose virtual on the server and is derived here
 * instead — the session comes back over the adapter, which returns plain
 * documents and runs no virtuals. It is one call site's worth of logic and it
 * belongs wherever the letter is rendered, not in two places.
 */
const shape = (u) =>
  u && {
    ...u,
    id: u.id,
    avatarLetter: (u.username ?? u.name ?? u.email ?? "?")[0].toUpperCase(),
  };

/**
 * DRIVEN OVER THE EXISTING AXIOS CLIENT, not `better-auth/react`.
 *
 * The endpoints are plain cookie-authenticated HTTP, so the client library
 * would buy a hook API this provider already exposes — at the cost of a second
 * auth implementation in the bundle, on a client that ships one eager chunk.
 * Same trade as declining Framer Motion for a fade.
 *
 * The interface below is UNCHANGED from the JWT version — `user`, `authReady`,
 * `login`, `register`, `logout`, `patchUser` — so ProtectedRoute, TopNav and
 * the Auth screen did not have to move.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  /**
   * False until the boot-time session read resolves. Without this,
   * ProtectedRoute would bounce an already-signed-in user to /auth on every
   * hard refresh — the single most common bug in this pattern, and it survives
   * the move to cookies: the cookie is present immediately, but whether it is
   * still a valid session is a round trip.
   */
  const [authReady, setAuthReady] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    // Returns 200 with a null body for an anonymous visitor rather than 401,
    // so "am I signed in" is not an error path.
    api
      .get("/auth/get-session")
      .then((res) => !cancelled && setUser(shape(res.data?.user)))
      .catch(() => {
        // No session — a normal signed-out visitor.
      })
      .finally(() => !cancelled && setAuthReady(true));

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Sign-in and sign-up both return the user, but the session cookie is what
   * actually authenticates the next request — so the state here is a mirror of
   * the cookie, not the source of truth.
   *
   * `queryClient.clear()` on every transition is deliberate: cached portfolio,
   * balance and watchlist data belongs to whoever was signed in a moment ago,
   * and showing one account's positions to the next is the worst possible
   * carry-over on a trading screen.
   */
  const adopt = useCallback(
    (data) => {
      const next = shape(data?.user);
      setUser(next);
      queryClient.clear();
      return next;
    },
    [queryClient]
  );

  const login = useCallback(
    async ({ email, username, password }) => {
      const identifier = String(email || username || "").trim();
      if (identifier.includes("@")) {
        return adopt(
          await post("/auth/sign-in/email", { email: identifier, password })
        );
      }
      return adopt(
        await post("/auth/sign-in/username", {
          username: identifier,
          password,
        })
      );
    },
    [adopt]
  );

  const register = useCallback(
    async ({ email, password, username, displayName, country }) => {
      const res = await post("/auth/sign-up/email", {
        email,
        password,
        username,
        // Better Auth requires `name`. The signup form does not ask for one —
        // it asks for a handle — so the handle stands in until the account
        // sets a display name rather than blocking the form on a field the
        // design does not have.
        name: displayName || username,
        ...(country && { country }),
      });
      // If a session token is returned immediately, adopt it.
      // When requireEmailVerification is on, token is null until OTP is verified.
      if (res?.token && res?.user) {
        adopt(res);
      }
      return res;
    },
    [adopt]
  );

  /**
   * Asks for a one-time code.
   *
   * THE THREE PURPOSES USE DIFFERENT ENDPOINTS and must not be collapsed: a
   * sign-in code, an email verification code, and a password-reset code carry
   * different subject lines, because somebody who receives "your sign-in code"
   * when they asked to reset a password has just learned that a stranger is in
   * their account.
   */
  const requestCode = useCallback(
    async ({ email, purpose }) => {
      if (purpose === "reset") {
        return post("/auth/email-otp/request-password-reset", { email });
      }
      if (purpose === "verify-email") {
        return post("/auth/email-otp/send-verification-otp", {
          email,
          type: "email-verification",
        });
      }
      return post("/auth/email-otp/send-verification-otp", {
        email,
        type: "sign-in",
      });
    },
    []
  );

  const signInWithCode = useCallback(
    async ({ email, otp }) =>
      adopt(await post("/auth/sign-in/email-otp", { email, otp })),
    [adopt]
  );

  const verifyEmailWithCode = useCallback(
    async ({ email, otp }) =>
      adopt(await post("/auth/email-otp/verify-email", { email, otp })),
    [adopt]
  );

  /**
   * Resets the password and signs in with it.
   *
   * The reset endpoint returns `{ success: true }`, not a session — so without
   * the second call the user is bounced back to a login form to type the
   * password they chose four seconds ago. They have just proven possession of
   * the address AND chosen the secret; asking again is ceremony.
   */
  const resetPasswordWithCode = useCallback(
    async ({ email, otp, password }) => {
      await post("/auth/email-otp/reset-password", { email, otp, password });
      return adopt(await post("/auth/sign-in/email", { email, password }));
    },
    [adopt]
  );

  /**
   * Starts the Google round trip.
   *
   * IT RETURNS A URL AND WE LEAVE THE PAGE — there is no session yet, and there
   * is nothing to `adopt`. Google redirects back to `/api/auth/callback/google`,
   * which sets the cookie server-side and then sends the browser to
   * `callbackURL`; the app boots fresh and the mount effect above picks the
   * session up. So the whole return leg is handled by the code that already
   * exists for "am I signed in".
   *
   * `errorCallbackURL` matters as much as the success one: without it a denied
   * consent, or a misconfigured client id, lands the user on Better Auth's own
   * error response rather than back on the screen they started from.
   */
  // Default matches Auth.jsx's: signing in lands on the landing page unless
  // a `?next=` said otherwise. Every caller passes one explicitly.
  const signInWithGoogle = useCallback(async (next = "/") => {
    const { url } = await post("/auth/sign-in/social", {
      provider: "google",
      callbackURL: `${window.location.origin}${next}`,
      errorCallbackURL: `${window.location.origin}/auth?error=oauth`,
    });
    if (url) window.location.href = url;
  }, []);

  const logout = useCallback(async () => {
    await post("/auth/sign-out").catch(() => {});
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  /** Called after a fill so the nav's cash balance reflects the new total. */
  const patchUser = useCallback(
    (changes) => setUser((u) => (u ? { ...u, ...changes } : u)),
    []
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        login,
        register,
        signInWithGoogle,
        requestCode,
        signInWithCode,
        verifyEmailWithCode,
        resetPasswordWithCode,
        logout,
        patchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
