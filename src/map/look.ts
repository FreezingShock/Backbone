// Map colors and imagery settings for each theme and map style. Map layers read these, not hex values of their own.
import type { ResolvedTheme } from '../theme/useTheme';
import type { HillshadePalette } from './hillshade';
import type { MapStyle } from './types';

export interface RoadTierLook {
  color: string;
  alpha: number;
}

export interface MapLook {
  theme: ResolvedTheme;
  style: MapStyle;
  /** Sky behind the globe. */
  space: string;
  /** Globe surface color, used under imagery and when imagery is off. */
  globe: string;
  lighting: boolean;
  imagery: {
    show: boolean;
    saturation: number;
    brightness: number;
    contrast: number;
    /** Below 1, imagery blends toward the globe color. Blueprint light uses this to fade toward paper. */
    alpha: number;
  };
  /** Place names and road labels. */
  ink: string;
  /** Outline behind labels, so they read on any surface. */
  halo: string;
  /** Place names use the serif face; road labels use the mono face. */
  placeInk: string;
  grid: string;
  /** Relief only: shaded terrain drawn as an imagery layer. See src/map/hillshade.ts. */
  hillshade?: HillshadePalette;
  roads: {
    artery: RoadTierLook;
    arterial: RoadTierLook;
    local: RoadTierLook;
    arteryLabel: string;
    arterialLabel: string;
  };
}

const PAPER: MapLook = {
  theme: 'light',
  style: 'relief',
  space: '#f2ead8',
  globe: '#e8dec6',
  lighting: true,
  imagery: { show: false, saturation: 1, brightness: 1, contrast: 1, alpha: 1 },
  ink: '#2a2620',
  halo: '#f2ead8',
  placeInk: '#2a2620',
  grid: 'rgb(42 38 32 / 0.2)',
  roads: {
    artery: { color: '#2a2620', alpha: 0.92 },
    arterial: { color: '#b8432a', alpha: 0.85 },
    local: { color: '#6b6254', alpha: 0.5 },
    arteryLabel: '#2a2620',
    arterialLabel: '#a0391f',
  },
};

const NAVY: MapLook = {
  theme: 'dark',
  style: 'blueprint',
  space: '#050d18',
  globe: '#0b1a2e',
  lighting: true,
  imagery: { show: true, saturation: 0, brightness: 0.5, contrast: 1.25, alpha: 1 },
  ink: '#d6ecf7',
  halo: '#050d18',
  placeInk: '#d6ecf7',
  grid: 'rgb(34 211 238 / 0.32)',
  roads: {
    artery: { color: '#f0fdff', alpha: 0.95 },
    arterial: { color: '#fbbf24', alpha: 0.8 },
    local: { color: '#38bdf8', alpha: 0.35 },
    arteryLabel: '#f0fdff',
    arterialLabel: '#fde68a',
  },
};

// Satellite keeps the photo. Roads and labels use the bright set so they read over dark imagery.
const SATELLITE_ROADS = NAVY.roads;

const RELIEF_PAPER: HillshadePalette = { shadow: '#5d5545', highlight: '#fbf6e9' };
const RELIEF_NAVY: HillshadePalette = { shadow: '#02060c', highlight: '#6fb5cc' };

export function mapLook(theme: ResolvedTheme, style: MapStyle): MapLook {
  if (style === 'satellite') {
    return {
      ...NAVY,
      theme,
      style,
      space: theme === 'dark' ? '#050d18' : '#f2ead8',
      globe: theme === 'dark' ? '#0b1a2e' : '#e8dec6',
      imagery: { show: true, saturation: 1, brightness: 1, contrast: 1, alpha: 1 },
      halo: '#050d18',
      placeInk: '#f0fdff',
      ink: '#f0fdff',
      grid: 'rgb(240 253 255 / 0.28)',
      roads: SATELLITE_ROADS,
    };
  }

  if (style === 'relief') {
    if (theme === 'light') return { ...PAPER, theme, style, hillshade: RELIEF_PAPER };
    return {
      ...NAVY,
      theme,
      style,
      globe: '#17304c',
      imagery: { ...NAVY.imagery, show: false },
      grid: 'rgb(34 211 238 / 0.22)',
      hillshade: RELIEF_NAVY,
    };
  }

  // Blueprint.
  if (theme === 'dark') return { ...NAVY, theme, style };
  return {
    ...PAPER,
    theme,
    style,
    globe: '#e8dec6',
    // Desaturated photo faded onto paper: the imagery sits above the globe color.
    imagery: { show: true, saturation: 0, brightness: 1.15, contrast: 1.1, alpha: 0.45 },
    grid: 'rgb(42 38 32 / 0.18)',
    roads: PAPER.roads,
  };
}
