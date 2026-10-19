import { useState } from 'react';
import { Chip, Panel } from '../ui/primitives';
import type { PlaybackController } from './controller';
import { loadSampleRoute } from './sampleRoute';

/**
 * Development entry point: plays the canyon-only sample route. Stays until the routing engine and the route planner
 * can supply real routes. Stop signs and lights on it are placeholders.
 */
export function SampleRouteButton({ controller }: { controller: PlaybackController | null }) {
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const play = () => {
    if (!controller) return;
    setState('loading');
    loadSampleRoute()
      .then((route) => {
        controller.start(route, 'orbit');
        setState('idle');
      })
      .catch((error: unknown) => {
        console.warn('Sample route: could not plan it', error);
        setState('error');
      });
  };

  return (
    <Panel title="Canyon Cutting">
      <div className="flex flex-col gap-2">
        <Chip onClick={play} disabled={!controller || state === 'loading'} className="self-start">
          {state === 'loading' ? 'Planning…' : 'Play sample route'}
        </Chip>
        {state === 'error' && (
          <p className="font-mono text-[11px] text-alert">Could not plan the sample route. Check the road layer.</p>
        )}
        <p className="font-mono text-[11px] leading-snug text-ink-3">
          Newbury Park to Calabasas over canyon crossings. Stop signs and lights are placeholders.
        </p>
      </div>
    </Panel>
  );
}
