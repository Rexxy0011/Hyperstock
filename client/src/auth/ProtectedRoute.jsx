import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import ComingSoon from '../pages/ComingSoon';

/**
 * @param {{ children: any, adminOnly?: boolean }} props
 */
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

  /**
   * NOT AN ADMIN: RENDER NOT-FOUND, DO NOT REDIRECT.
   *
   * This used to `<Navigate to="/portfolio">`, and it was wrong twice over.
   *
   * IT DEFEATED THE REASON THE SECTION IS AT `/soap`. That prefix is obscurity
   * and is described as obscurity — the point is that somebody probing gets the
   * ordinary Not-found page and learns nothing. A REDIRECT IS AN ANSWER: an
   * unknown path renders Not-found, so a path that instead bounces you
   * somewhere real confirms it exists. `/soapx/approvals` and `/soap/approvals`
   * have to be indistinguishable to a non-admin, and a redirect made them
   * trivially distinguishable.
   *
   * AND IT PUT LOGIN ON THE WRONG PAGE. Signed out, `/soap` sends you to
   * `/auth?next=%2Fsoap`; `?next=` correctly wins on the way back, so an
   * ordinary trader signing in was carried to the admin prefix and then dumped
   * on `/portfolio` — a page they never asked for, reached by a route they were
   * not allowed down. Measured exactly that.
   *
   * Rendering in place also leaves the URL alone, so nothing lands in history
   * for the user to press Back through.
   *
   * What it does NOT hide is the shell: this renders inside `DashboardLayout`
   * while the router's catch-all renders inside `PublicLayout`, so the two
   * Not-founds differ in their chrome. Closing that means mounting the admin
   * routes outside the dashboard shell, which is a larger change than this one.
   * The API is the bigger leak either way and is untouched — `/api/admin/*`
   * still answers 401 rather than 404, as the note in `navItems.js` records.
   */
  if (adminOnly && user.role !== 'admin') {
    return <ComingSoon title="Not found" />;
  }

  return children;
}
