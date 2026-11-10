import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import './page.css';
import { App } from './App';
import { parseWarning, Warning } from './Warning';

const warning = parseWarning(location.search);

createRoot(document.getElementById('root')!).render(
  <StrictMode>{warning ? <Warning warning={warning} /> : <App />}</StrictMode>,
);
