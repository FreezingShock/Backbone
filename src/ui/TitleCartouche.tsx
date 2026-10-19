import { useEffect, useState } from 'react';
import * as Cesium from 'cesium';
import { formatLength, niceLength } from '../map/scaleMath';

// Half the width, in pixels, of the stretch measured at screen center to set the scale.
const SAMPLE_HALF_WIDTH_PX = 60;
const BAR_TARGET_PX = 120;

/** Meters per screen pixel where the view is centered, or null if the center is off the globe. */
function metersPerPixel(viewer: Cesium.Viewer): number | null {
  const { canvas } = viewer.scene;
  const y = Math.round(canvas.clientHeight * 0.5);
  const x = Math.round(canvas.clientWidth * 0.5);
  const left = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(x - SAMPLE_HALF_WIDTH_PX, y));
  const right = viewer.camera.pickEllipsoid(new Cesium.Cartesian2(x + SAMPLE_HALF_WIDTH_PX, y));
  if (!left || !right) return null;
  return Cesium.Cartesian3.distance(left, right) / (2 * SAMPLE_HALF_WIDTH_PX);
}

export interface TitleCartoucheProps {
  viewer: Cesium.Viewer | null;
}

/** Title block with a scale bar, in the bottom-left corner like a printed map. */
export function TitleCartouche({ viewer }: TitleCartoucheProps) {
  const [scale, setScale] = useState<{ meters: number; px: number } | null>(null);

  useEffect(() => {
    if (!viewer) return;
    let frame = 0;
    // Batch the camera's `changed` events to one measurement per frame. Keep the old bar when the scale is unchanged,
    // so React skips the re-render.
    const sync = () => {
      frame = 0;
      const mpp = metersPerPixel(viewer);
      const next = mpp ? niceLength(mpp, BAR_TARGET_PX) : null;
      setScale((prev) => (prev && next && prev.meters === next.meters && prev.px === next.px ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    sync();
    const removeListener = viewer.camera.changed.addEventListener(schedule);
    return () => {
      removeListener();
      cancelAnimationFrame(frame);
    };
  }, [viewer]);

  return (
    <figure className="plate plate-frame pointer-events-none m-0 w-72 p-4 pb-3">
      <figcaption className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] tracking-[0.3em] text-ink-3 uppercase">Backbone · Open data</span>
        <span className="font-serif text-[22px] leading-tight text-ink">Topanga &amp; the Santa Monica Mountains</span>
      </figcaption>

      <div className="mt-3 flex items-end gap-3 border-t border-rule pt-2.5">
        {scale ? (
          <>
            <div className="flex flex-col gap-1">
              <span
                className="block h-[7px] border border-ink"
                style={{
                  width: `${scale.px}px`,
                  background: 'linear-gradient(to right, var(--c-ink) 50%, transparent 50%)',
                }}
                aria-hidden
              />
              <span className="flex justify-between font-mono text-[10px] text-ink-2" style={{ width: `${scale.px}px` }}>
                <span>0</span>
                <span>{formatLength(scale.meters)}</span>
              </span>
            </div>
          </>
        ) : (
          <span className="font-mono text-[10px] text-ink-3">scale unavailable at this view</span>
        )}
      </div>
    </figure>
  );
}
