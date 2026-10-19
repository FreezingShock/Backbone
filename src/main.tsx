import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles/index.css';
import App from './App';

// Anthropic Serif is licensed, not open source, so its files are never committed. They sit in
// src/fonts/anthropic-serif/ (gitignored). Whatever is present gets registered here; when nothing is
// present, no font is requested and the serif stack falls back to IM Fell English. See docs/design-system.md.
const SERIF_WEIGHTS: Record<string, number> = { Light: 300, Regular: 400, Medium: 500, Semibold: 600, Bold: 700, Extrabold: 800 };
const serifFiles = import.meta.glob('./fonts/anthropic-serif/*.{otf,woff2}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
for (const [path, url] of Object.entries(serifFiles)) {
  const match = /-(Text|Display)-(\w+?)(Italic)?-Static\.(otf|woff2)$/.exec(path);
  const weight = match && SERIF_WEIGHTS[match[2]];
  if (!match || !weight) continue;
  const family = match[1] === 'Text' ? 'Anthropic Serif' : 'Anthropic Serif Display';
  const format = match[4] === 'woff2' ? 'woff2' : 'opentype';
  document.fonts.add(new FontFace(family, `url(${url}) format("${format}")`, { weight: String(weight), style: match[3] ? 'italic' : 'normal', display: 'swap' }));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
