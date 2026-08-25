import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, authReady } = useAuth();
  const location = useLocation();

  // Wait for the boot-time refresh before deciding — see AuthProvider.
  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="h-10 w-40 animate-pulse rounded-lg bg-hover" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to={`/auth?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/portfolio" replace />;
  }

  return children;
}
