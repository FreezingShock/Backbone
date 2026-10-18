import type { ThemePreference } from '../theme/useTheme';
import type { MapStyle } from '../map/types';
import { Chip, Panel } from './primitives';

const STYLE_LABEL: Record<MapStyle, string> = {
  blueprint: 'Blueprint',
  satellite: 'Satellite',
  relief: 'Relief',
};

const STYLE_NOTE: Record<MapStyle, string> = {
  blueprint: 'Photo faded to a line map.',
  satellite: 'Aerial imagery, as captured.',
  relief: 'Shaded terrain, no photo.',
};

const THEME_LABEL: Record<ThemePreference, string> = {
  auto: 'Auto',
  light: 'Light',
  dark: 'Dark',
};

export interface StylePanelProps {
  mapStyle: MapStyle;
  onMapStyle: (value: MapStyle) => void;
  preference: ThemePreference;
  onPreference: (value: ThemePreference) => void;
}

export function StylePanel({ mapStyle, onMapStyle, preference, onPreference }: StylePanelProps) {
  return (
    <Panel title="Map style" bodyClassName="flex flex-col gap-3 p-3">
      <div role="group" aria-label="Map style" className="flex flex-wrap gap-1.5">
        {(Object.keys(STYLE_LABEL) as MapStyle[]).map((style) => (
          <Chip key={style} active={mapStyle === style} onClick={() => onMapStyle(style)}>
            {STYLE_LABEL[style]}
          </Chip>
        ))}
      </div>
      <p className="font-serif text-[13px] italic text-ink-2">{STYLE_NOTE[mapStyle]}</p>

      <div className="flex items-center justify-between gap-2 border-t border-rule pt-3">
        <span className="font-mono text-[10px] tracking-[0.2em] text-ink-3 uppercase">Theme</span>
        <div role="group" aria-label="Theme" className="flex gap-1.5">
          {(Object.keys(THEME_LABEL) as ThemePreference[]).map((value) => (
            <Chip key={value} active={preference === value} onClick={() => onPreference(value)}>
              {THEME_LABEL[value]}
            </Chip>
          ))}
        </div>
      </div>
    </Panel>
  );
}
