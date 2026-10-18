import { useSyncExternalStore } from 'react';
import { getPlaceSelection, pinPlace, subscribePlaceSelection } from '../map/placeSelection';
import { KIND_LABEL, type Place } from '../map/places';
import { Chip, Panel } from './primitives';

export interface PlaceCardProps {
  onFlyTo: (place: Place) => void;
}

/**
 * The blurb for the place under the pointer (hover), or the one the user clicked (pinned). The hover card
 * ignores the pointer, so it never blocks the map. The pinned card takes clicks and has a fly-to button.
 */
export function PlaceCard({ onFlyTo }: PlaceCardProps) {
  const selection = useSyncExternalStore(subscribePlaceSelection, getPlaceSelection);
  const pinned = selection.pinned !== null;
  const place = selection.pinned ?? selection.hovered;
  if (!place) return null;

  return (
    <div
      className={`absolute bottom-10 left-1/2 w-80 -translate-x-1/2 ${pinned ? 'pointer-events-auto' : 'pointer-events-none'}`}
      aria-live="polite"
    >
      <Panel bodyClassName="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.2em] text-ink-3 uppercase">{KIND_LABEL[place.kind]}</p>
            <h2 className="font-serif text-[21px] leading-tight text-ink">{place.name}</h2>
          </div>
          {pinned && (
            <button
              type="button"
              aria-label="Close place card"
              onClick={() => pinPlace(null)}
              className="cursor-pointer font-mono text-[16px] leading-none text-ink-3 hover:text-ink"
            >
              ×
            </button>
          )}
        </div>
        {place.blurb && <p className="mt-2 text-[13px] leading-snug text-ink-2">{place.blurb}</p>}
        <div className="mt-3 flex items-center justify-between gap-2">
          {pinned ? (
            <Chip onClick={() => onFlyTo(place)}>Fly there</Chip>
          ) : (
            <span className="font-mono text-[10px] text-ink-3">Click to pin</span>
          )}
          <span className="font-mono text-[10px] text-ink-3 tabular-nums">
            {place.lat.toFixed(4)}, {place.lon.toFixed(4)}
          </span>
        </div>
        {place.source && <p className="mt-2 font-mono text-[9px] leading-snug text-ink-3">Source: {place.source}</p>}
      </Panel>
    </div>
  );
}
