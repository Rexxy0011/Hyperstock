import { useAuth } from '../auth/AuthProvider';
import DashboardLayout from './DashboardLayout';
import PublicLayout from './PublicLayout';

/**
 * Markets and Leaderboard belong to both worlds: a signed-out visitor should
 * see them as marketing pages (with the footer and a route to sign up), while a
 * signed-in trader should see them as app screens inside the dashboard panel.
 *
 * Choosing the shell by route instead of by session was what made the product
 * look like two different apps once you logged in.
 */
export default function AdaptiveLayout() {
  const { user, authReady } = useAuth();

  // Render nothing rather than the wrong shell — swapping layouts one frame
  // later is a visible flash.
  if (!authReady) return <div className="min-h-screen bg-white" />;

  return user ? <DashboardLayout /> : <PublicLayout />;
}
