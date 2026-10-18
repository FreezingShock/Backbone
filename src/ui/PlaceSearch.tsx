import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { KIND_LABEL, searchPlaces, type Place } from '../map/places';

export interface PlaceSearchProps {
  onPick: (place: Place) => void;
}

/** A search box that lists matching places. Enter or a click flies to the place and pins its card. */
export function PlaceSearch({ onPick }: PlaceSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => searchPlaces(query), [query]);
  const showList = open && results.length > 0;

  const pick = (place: Place) => {
    setQuery('');
    setOpen(false);
    onPick(place);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (results.length ? (index + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => (results.length ? (index - 1 + results.length) % results.length : 0));
    } else if (event.key === 'Enter' && showList) {
      event.preventDefault();
      pick(results[Math.min(active, results.length - 1)]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        type="search"
        role="combobox"
        aria-label="Search places"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder="Find a place"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="w-52 rounded-[2px] border border-rule bg-transparent px-2 py-1 font-serif text-[14px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching places"
          className="plate absolute top-full left-0 z-10 mt-1 w-64 overflow-hidden py-1"
        >
          {results.map((place, index) => (
            <li
              key={place.id}
              role="option"
              aria-selected={index === active}
              // Mouse down, not click: the input blurs first, which would close the list before the click lands.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(place);
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 ${
                index === active ? 'bg-accent-soft text-accent' : 'text-ink'
              }`}
            >
              <span className="font-serif text-[15px]">{place.name}</span>
              <span className="font-mono text-[10px] tracking-wider text-ink-3 uppercase">{KIND_LABEL[place.kind]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
