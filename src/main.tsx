import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/cinzel';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/cormorant-garamond/600-italic.css';
import App from './App';
import { setLanguage } from './core/language';
import { currentGraphName, languageOf } from './graphs';
import './index.css';

// Before anything renders: answers, tenses and the voice follow the word list's language.
setLanguage(languageOf(currentGraphName()));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
