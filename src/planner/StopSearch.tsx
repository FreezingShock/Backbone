import { useEffect, useId, useState, type KeyboardEvent, type Ref } from 'react';
import { suggestStops } from './engine';
import { messageOf } from './useRoutePlan';
import type { Network, Stop } from './types';
import type { SuggestNear } from '../routing/types';

const KIND_LABEL: Record<Stop['kind'], string> = {
  city: 'Center',
  poi: 'Place',
  intersection: 'Junction',
  custom: 'Pin',
};

const SEARCH_SETTLE_MS = 80;

export interface StopSearchProps {
  network: Network;
  /** The last stop on the route. Suggestions near it come first. */
  near?: SuggestNear;
  placeholder: string;
  onPick: (stop: Stop) => void;
  inputRef?: Ref<HTMLInputElement>;
}

/** Search box with suggestions: city centers, places, and road junctions on the chosen network. */
export function StopSearch({ network, near, placeholder, onPick, inputRef }: StopSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<Stop[]>([]);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const showList = open && (results.length > 0 || error !== null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      suggestStops(query, { network, near })
        .then((stops) => {
          if (cancelled) return;
          setResults(stops);
          setError(null);
          setActive(0);
        })
        .catch((failure: unknown) => {
          if (!cancelled) setError(messageOf(failure));
        });
    }, SEARCH_SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, network, near?.lon, near?.lat]);

  const pick = (stop: Stop) => {
    setQuery('');
    setOpen(false);
    onPick(stop);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (results.length ? (index + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
    } else if (event.key === 'Enter' && showList && results.length > 0) {
      event.preventDefault();
      pick(results[Math.min(active, results.length - 1)]);
    } else if (event.key === 'Escape') {
      if (query) setQuery('');
      else setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Add a stop"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="w-full rounded-[2px] border border-rule bg-transparent px-2.5 py-1.5 font-serif text-[15px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={query ? 'Matching stops' : 'Suggested stops'}
          className="plate absolute top-full left-0 z-30 mt-1 max-h-72 w-full overflow-y-auto py-1"
        >
          <li role="presentation" className="px-3 pt-1 pb-1.5 font-mono text-[10px] tracking-[0.18em] text-ink-3 uppercase">
            {query ? 'Matches' : near ? 'Near your last stop' : 'Suggested'}
          </li>
          {error && (
            <li role="presentation" className="px-3 py-1.5 font-mono text-[11px] text-alert">
              Roads did not load: {error}
            </li>
          )}
          {results.map((stop, index) => (
            <li
              key={stop.id}
              role="option"
              aria-selected={index === active}
              // Mouse down, not click: the input blurs first, which would close the list before the click lands.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(stop);
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 ${
                index === active ? 'bg-accent-soft text-accent' : 'text-ink'
              }`}
            >
              <span className="min-w-0 truncate font-serif text-[15px]">{stop.name}</span>
              <span className="shrink-0 font-mono text-[10px] tracking-wider text-ink-3 uppercase">{KIND_LABEL[stop.kind]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
