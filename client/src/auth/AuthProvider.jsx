import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, post, setAccessToken } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  /**
   * False until the boot-time refresh resolves. Without this, ProtectedRoute
   * would bounce an already-signed-in user to /auth on every hard refresh —
   * the single most common bug in the memory-token pattern.
   */
  const [authReady, setAuthReady] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    api
      .post('/auth/refresh')
      .then((res) => {
        if (cancelled) return;
        setAccessToken(res.data.accessToken);
        setUser(res.data.user);
      })
      .catch(() => {
        // No valid cookie — a normal signed-out visitor.
      })
      .finally(() => !cancelled && setAuthReady(true));

    return () => {
      cancelled = true;
    };
  }, []);

  const adopt = useCallback(
    (data) => {
      setAccessToken(data.accessToken);
      setUser(data.user);
      queryClient.clear();
      return data.user;
    },
    [queryClient],
  );

  const login = useCallback(
    async (credentials) => adopt(await post('/auth/login', credentials)),
    [adopt],
  );

  const register = useCallback(
    async (details) => adopt(await post('/auth/register', details)),
    [adopt],
  );

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => {});
    setAccessToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  /** Called after a fill so the nav's cash balance reflects the new total. */
  const patchUser = useCallback((changes) => setUser((u) => (u ? { ...u, ...changes } : u)), []);

  return (
    <AuthContext.Provider value={{ user, authReady, login, register, logout, patchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
