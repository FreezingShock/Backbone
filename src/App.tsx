import { useCallback, useMemo, useState } from 'react';
import type * as Cesium from 'cesium';
import { MapView, type FlyTarget } from './map/MapView';
import { HOME_PLACE, type Place } from './map/places';
import { pinPlace } from './map/placeSelection';
import { mapLook } from './map/look';
import type { CameraMode, MapStyle, RuntimeStatus } from './map/types';
import { mapLayers } from './layers/registry';
import { FREEFLY_SPEED } from './map/freeFly';
import { useTheme } from './theme/useTheme';
import { Compass } from './ui/Compass';
import { PlaceCard } from './ui/PlaceCard';
import { LayerPanel } from './ui/LayerPanel';
import { StylePanel } from './ui/StylePanel';
import { TitleCartouche } from './ui/TitleCartouche';
import { Toolbar } from './ui/Toolbar';
import { NavigationHUD, PlaybackControls, SampleRouteButton, usePlaybackController } from './playback';

function defaultVisibility(): Record<string, boolean> {
  return Object.fromEntries(mapLayers.map((layer) => [layer.id, layer.defaultVisible]));
}

export default function App() {
  const { preference, theme, setPreference } = useTheme();
  const [visibility, setVisibility] = useState(defaultVisibility);
  const [mapStyle, setMapStyle] = useState<MapStyle>('blueprint');
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');
  const [cameraSpeed, setCameraSpeed] = useState<number>(FREEFLY_SPEED.default);
  const [exaggeration, setExaggeration] = useState(1);
  const [flyTo, setFlyTo] = useState<FlyTarget>({ place: HOME_PLACE, nonce: 0 });
  const [status, setStatus] = useState<RuntimeStatus>({ imagery: 'loading', terrain: 'loading' });
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const look = useMemo(() => mapLook(theme, mapStyle), [theme, mapStyle]);
  const playback = usePlaybackController(viewer, look);

  const onStatus = useCallback(
    (next: Partial<RuntimeStatus>) => setStatus((prev) => ({ ...prev, ...next })),
    [],
  );

  const goTo = (place: Place) => setFlyTo((prev) => ({ place, nonce: prev.nonce + 1 }));
  // A search result flies to the place and pins its card, so the blurb is on screen when the camera arrives.
  const pick = (place: Place) => {
    pinPlace(place);
    goTo(place);
  };

  const setLayerVisible = (id: string, visible: boolean) =>
    setVisibility((prev) => ({ ...prev, [id]: visible }));

  return (
    <main className="relative h-full w-full overflow-hidden">
      <MapView
        layers={mapLayers}
        visibility={visibility}
        look={look}
        exaggeration={exaggeration}
        cameraMode={cameraMode}
        cameraSpeed={cameraSpeed}
        flyTo={flyTo}
        onStatus={onStatus}
        onViewer={setViewer}
      />
      <Toolbar
        cameraMode={cameraMode}
        onCameraMode={setCameraMode}
        cameraSpeed={cameraSpeed}
        onCameraSpeed={setCameraSpeed}
        onGoTo={goTo}
        onPick={pick}
      />
      <NavigationHUD controller={playback} />
      <PlaybackControls controller={playback} />
      <PlaceCard onFlyTo={goTo} />

      <aside className="absolute top-4 right-4 bottom-36 flex w-64 flex-col gap-3">
        <SampleRouteButton controller={playback} />
        <StylePanel
          mapStyle={mapStyle}
          onMapStyle={setMapStyle}
          preference={preference}
          onPreference={setPreference}
        />
        <LayerPanel
          layers={mapLayers}
          visibility={visibility}
          onToggle={setLayerVisible}
          exaggeration={exaggeration}
          onExaggeration={setExaggeration}
          status={status}
          look={look}
        />
      </aside>

      <div className="pointer-events-none absolute bottom-10 left-4">
        <TitleCartouche viewer={viewer} />
      </div>
      <div className="pointer-events-none absolute right-4 bottom-10">
        <Compass viewer={viewer} />
      </div>
    </main>
  );
}
