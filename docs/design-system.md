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

- **IM Fell English** (serif, OFL): wordmark, panel titles, place names, the title cartouche.
- **IBM Plex Mono** (OFL): controls, data, labels for roads, status.

Both come from `@fontsource`, so they are bundled and work offline. Canvas labels need the font loaded before they are drawn, so `MapView` waits for `document.fonts.load()` before it mounts layers.

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
