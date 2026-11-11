import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import { setBrandFavicon } from '@/lib/favicon';
import { App } from './App';
import { bootTheme } from '../newtab/theme';

void bootTheme();
setBrandFavicon();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
