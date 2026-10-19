# Backbone design system

Cartographic and minimal. Two themes, three map styles.

## Themes

- **Light:** warm paper, ink-gray text, one orange-red accent.
- **Dark:** the blueprint navy and cyan, refined.
- **Auto** (the default) follows the OS setting. Light or Dark, once picked, is remembered in this browser (`localStorage`, key `backbone-theme`).

The resolved theme is set as `data-theme` on `<html>`. `index.html` sets it before first paint, so there is no flash.

## Tokens

Colors are CSS variables on `:root` and `:root[data-theme="dark"]` in `src/styles/index.css`, exposed to Tailwind as theme colors:

| Class | Use |
|-------|-----|
| `bg-paper`, `bg-paper-2` | Page and deeper surfaces |
| `bg-surface` | Panel plates (translucent) |
| `text-ink`, `text-ink-2`, `text-ink-3` | Primary, secondary, muted text |
| `border-rule` | Hairlines and panel edges |
| `text-accent`, `bg-accent-soft` | Selection, titles, the one accent |
| `text-warn`, `text-alert` | Status |

Do not write hex colors in components. Map colors are the exception, and they live in one place: `src/map/look.ts`.

## Type

- **Anthropic Serif** (licensed, not open source): the first entry in the serif stack. Its OTF files live in `src/fonts/anthropic-serif/`, which is gitignored, so the files are never committed. `src/main.tsx` registers whatever is there as `FontFace` objects: Text as "Anthropic Serif", Display as "Anthropic Serif Display". With no files present, nothing is requested and the site uses IM Fell English. The font is licensed to the project owner and is not covered by this repo's open-source terms. Check the license before the site is shared publicly.
- **IM Fell English** (serif, OFL): the fallback serif. Wordmark, panel titles, place names, the title cartouche.
- **IBM Plex Mono** (OFL): controls, data, labels for roads, status.

IM Fell English and IBM Plex Mono come from `@fontsource`, so they are bundled and work offline. Canvas labels need the font loaded before they are drawn, so `MapView` waits for `document.fonts.load()` before it mounts layers. `LABEL_FONTS` in `src/map/MapView.tsx` lists "Anthropic Serif" too, so canvas labels wait for it. Without the files, that load resolves immediately and labels stay in IM Fell English.

## Map styles

Set in `src/map/look.ts` (`mapLook(theme, style)`). Layers take colors from the look and recolor in place with `restyle`, so switching styles does not rebuild geometry.

| Style | Light | Dark |
|-------|-------|------|
| **Blueprint** | Photo desaturated and faded onto paper (imagery alpha 0.45 over a paper globe) | Photo desaturated and dimmed on navy |
| **Satellite** | Aerial imagery as captured | Same |
| **Relief** | Shaded terrain on cream, no photo | Shaded terrain on dark slate |

Terrain: with a Cesium ion token, Cesium World Terrain. Without one, AWS Terrain Tiles (open, no key; attribution shown on the globe). Relief looks flat without terrain.

## Cartographic touches

- **Title cartouche** (bottom left): wordmark-style title, a live scale bar that picks round lengths.
- **Compass rose** (bottom right): turns with the camera heading. Click to face north.
