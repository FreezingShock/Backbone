import { useEffect, useState } from 'react';
import * as Cesium from 'cesium';

/** Compass rose. The north point turns with the camera heading. Click to face north. */
export function Compass({ viewer }: { viewer: Cesium.Viewer | null }) {
  const [heading, setHeading] = useState(0);

  useEffect(() => {
    if (!viewer) return;
    const update = () => setHeading(Cesium.Math.toDegrees(viewer.camera.heading));
    update();
    return viewer.camera.changed.addEventListener(update);
  }, [viewer]);

  const faceNorth = () => {
    if (!viewer) return;
    const { camera } = viewer;
    camera.flyTo({
      destination: Cesium.Cartesian3.clone(camera.position),
      orientation: { heading: 0, pitch: camera.pitch, roll: 0 },
      duration: 0.8,
    });
  };

  return (
    <button
      type="button"
      onClick={faceNorth}
      title="Face north"
      aria-label="Compass: face north"
      className="plate pointer-events-auto grid size-[88px] cursor-pointer place-items-center rounded-full"
    >
      <svg viewBox="-50 -50 100 100" className="size-[76px] overflow-visible" aria-hidden>
        <g style={{ transform: `rotate(${-heading}deg)`, transition: 'transform 120ms linear' }}>
          <circle r="36" fill="none" stroke="var(--c-rule)" strokeWidth="1" />
          <circle r="30" fill="none" stroke="var(--c-rule)" strokeWidth="0.6" strokeDasharray="1 2" />
          {Array.from({ length: 16 }, (_, i) => (
            <line
              key={i}
              x1="0"
              y1="-36"
              x2="0"
              y2={i % 4 === 0 ? -44 : -40}
              stroke="var(--c-ink-2)"
              strokeWidth={i % 4 === 0 ? 1 : 0.6}
              transform={`rotate(${i * 22.5})`}
            />
          ))}
          <polygon points="0,-30 6,0 -6,0" fill="var(--c-accent)" />
          <polygon points="0,30 6,0 -6,0" fill="var(--c-ink-3)" />
          <polygon points="-30,0 0,-5 0,5" fill="var(--c-ink-3)" opacity="0.6" />
          <polygon points="30,0 0,-5 0,5" fill="var(--c-ink-3)" opacity="0.6" />
          <circle r="2" fill="var(--c-ink)" />
          <text y="-24" textAnchor="middle" fontFamily="IM Fell English, Georgia, serif" fontSize="10" fill="var(--c-accent)" dy="-14">
            N
          </text>
          <text y="20" textAnchor="middle" fontFamily="IM Fell English, Georgia, serif" fontSize="8" fill="var(--c-ink-3)" dy="14">
            S
          </text>
          <text x="-20" textAnchor="middle" fontFamily="IM Fell English, Georgia, serif" fontSize="8" fill="var(--c-ink-3)" dy="3">
            W
          </text>
          <text x="20" textAnchor="middle" fontFamily="IM Fell English, Georgia, serif" fontSize="8" fill="var(--c-ink-3)" dy="3">
            E
          </text>
        </g>
      </svg>
    </button>
  );
}
