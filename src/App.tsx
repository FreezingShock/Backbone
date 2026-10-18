import { useCallback, useState } from 'react';
import { MapView, type FlyTarget } from './map/MapView';
import { HOME_PLACE, type Place } from './map/places';
import type { BasemapStyle, CameraMode, RuntimeStatus } from './map/types';
import { mapLayers } from './layers/registry';
import { FREEFLY_SPEED } from './map/freeFly';
import { Toolbar } from './ui/Toolbar';
import { LayerPanel } from './ui/LayerPanel';

function defaultVisibility(): Record<string, boolean> {
  return Object.fromEntries(mapLayers.map((layer) => [layer.id, layer.defaultVisible]));
}

export default function App() {
  const [visibility, setVisibility] = useState(defaultVisibility);
  const [basemap, setBasemap] = useState<BasemapStyle>('blueprint');
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [cameraSpeed, setCameraSpeed] = useState<number>(FREEFLY_SPEED.default);
  const [exaggeration, setExaggeration] = useState(1);
  const [flyTo, setFlyTo] = useState<FlyTarget>({ place: HOME_PLACE, nonce: 0 });
  const [status, setStatus] = useState<RuntimeStatus>({ imagery: 'loading', terrain: 'loading' });

  const onStatus = useCallback(
    (next: Partial<RuntimeStatus>) => setStatus((prev) => ({ ...prev, ...next })),
    [],
  );

  const goTo = (place: Place) => setFlyTo((prev) => ({ place, nonce: prev.nonce + 1 }));

  const setLayerVisible = (id: string, visible: boolean) =>
    setVisibility((prev) => ({ ...prev, [id]: visible }));

  return (
    <main className="relative h-full w-full overflow-hidden">
      <MapView
        layers={mapLayers}
        visibility={visibility}
        basemap={basemap}
        exaggeration={exaggeration}
        cameraMode={cameraMode}
        cameraSpeed={cameraSpeed}
        flyTo={flyTo}
        onStatus={onStatus}
      />
      <Toolbar
        basemap={basemap}
        onBasemap={setBasemap}
        cameraMode={cameraMode}
        onCameraMode={setCameraMode}
        cameraSpeed={cameraSpeed}
        onCameraSpeed={setCameraSpeed}
        onGoTo={goTo}
      />
      <LayerPanel
        layers={mapLayers}
        visibility={visibility}
        onToggle={setLayerVisible}
        exaggeration={exaggeration}
        onExaggeration={setExaggeration}
        status={status}
      />
    </main>
  );
}
