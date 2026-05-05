import '../styles/tokens.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from 'react-query';
import { queryClient } from './queryClient';
import App from './components/App';
import i18n from './i18n';

const container = document.getElementById('root');
if (!container) {
  throw new Error(i18n.t('errors.missingRoot', { ns: 'common' }));
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
); 