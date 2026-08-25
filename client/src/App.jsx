import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from './lib/queryClient';
import { router } from './router';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* AuthProvider needs the query client (it clears caches on login and
          logout), so it is mounted inside the router tree — see router.jsx. */}
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
