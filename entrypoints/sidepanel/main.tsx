import React from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import App from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import '@/assets/tailwind.css';

// Register all interactive tool UI components (side-effect)
import '@/lib/tools/ui-registrations';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <React.StrictMode>
      <MemoryRouter initialEntries={['/chat/new']}>
        <App />
      </MemoryRouter>
    </React.StrictMode>
  </ErrorBoundary>,
);
