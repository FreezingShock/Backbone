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
  const [detail, setDetail] = useState('');

  // Planning and starting fail in different places, so each reports its own message. A start error used to show
  // as a road-layer error, which hid the real cause.
  const fail = (what: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Sample route: ${what}`, error);
    setDetail(`${what}: ${message}`);
    setState('error');
  };

  const play = () => {
    if (!controller) return;
    setState('loading');
    setDetail('');
    loadSampleRoute().then(
      (route) => {
        try {
          controller.start(route, 'orbit');
          setState('idle');
        } catch (error: unknown) {
          fail('Playback could not start', error);
        }
      },
      (error: unknown) => fail('Could not plan the sample route', error),
    );
  };

  return (
    <Panel title="Canyon Cutting">
      <div className="flex flex-col gap-2">
        <Chip onClick={play} disabled={!controller || state === 'loading'} className="self-start">
          {state === 'loading' ? 'Planning…' : 'Play sample route'}
        </Chip>
        {state === 'error' && <p className="font-mono text-[11px] leading-snug text-alert">{detail}</p>}
        <p className="font-mono text-[11px] leading-snug text-ink-3">
          Newbury Park to Calabasas over canyon crossings. Stop signs and lights are placeholders.
        </p>
      </div>
    </Panel>
  );
}
