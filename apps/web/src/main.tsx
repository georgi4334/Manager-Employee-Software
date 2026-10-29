import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initI18n } from './i18n';
import { initTheme } from './shared/stores/theme.store';
import './styles/globals.css';

initTheme();

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

// The static boot screen in index.html stays until the texts are there: rendering earlier would
// replace it with an empty page while the first components wait for their translations.
void initI18n()
  .catch(() => undefined)
  .finally(() => {
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
