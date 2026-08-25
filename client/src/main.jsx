import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
// Before App, so the first render already has the right language and the right
// digit grouping — mounting first would paint English and then swap.
import './i18n';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
