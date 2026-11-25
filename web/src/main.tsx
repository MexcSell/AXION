import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/exo-2';
import '@fontsource-variable/jetbrains-mono';
import './theme/tokens.css';
import './theme/base.css';
import './theme/shell.css';
import './theme/pages.css';
import './theme/touch.css';
import App from './App';
// Test-only controls are loaded only in development or when a browser test enables them.
const hookOn = (() => { try { return import.meta.env.DEV || localStorage.getItem('axion.testhook') === '1'; } catch { return import.meta.env.DEV; } })();
if (hookOn) {
  void Promise.all([import('./store/ui'), import('./store/data')]).then(([{ useUI }, { useData }]) => {
    (window as unknown as { __axion: unknown }).__axion = {
      openDialog: useUI.getState().openDialog,
      closeAll: () => useUI.setState({ dialogs: [] }),
      helpKeys: async () => Object.keys((await (await import('./help/load')).loadHelp()).HELP),
      dialogIds: async () => Object.keys(await (await import('./dialogs/DialogHost')).loadDialogs()),
      data: useData,
    };
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
