import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { config, MAX_IMAGERY_LEVEL } from '../config';
import type { LayerHandle, MapLayer } from '../layers/types';
import type { MapLook } from './look';
import { createHillshade } from './hillshade';
import { applyDaylight } from './daylight';
import { attachFreeFly } from './freeFly';
import { createOpenTerrain } from './openTerrain';
import type { Place } from './places';
import { attachRenderQuality } from './renderQuality';
import { attachPauseWhenHidden } from './pauseWhenHidden';
import type { CameraMode, RuntimeStatus } from './types';

export interface FlyTarget {
  place: Place;
  /** Bump to fly again to the same place. */
  nonce: number;
}

export interface MapViewProps {
  layers: MapLayer[];
  visibility: Record<string, boolean>;
  /** Colors and imagery settings for the current theme and map style. See src/map/look.ts. */
  look: MapLook;
  exaggeration: number;
  cameraMode: CameraMode;
  /** Free-fly speed multiplier from the UI. Read every frame, so changing it does not restart free-fly. */
  cameraSpeed: number;
  flyTo: FlyTarget;
  onStatus: (status: Partial<RuntimeStatus>) => void;
  /** Receives the Cesium viewer once it exists, and null when it is torn down. */
  onViewer: (viewer: Cesium.Viewer | null) => void;
}

const LABEL_FONTS = ['17px "Anthropic Serif"', '17px "IM Fell English"', '12px "IBM Plex Mono"'];

export function MapView({
  layers,
  visibility,
  look,
  exaggeration,
  cameraMode,
  cameraSpeed,
  flyTo,
  onStatus,
  onViewer,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const [imagery, setImagery] = useState<Cesium.ImageryLayer | null>(null);
  // Bumped when layers finish mounting, so visibility is applied to the new handles.
  const [mountedVersion, setMountedVersion] = useState(0);
  const handlesRef = useRef(new Map<string, LayerHandle>());
  // The clock time the viewer started with. The dark theme returns to it. See src/map/daylight.ts.
  const startTimeRef = useRef<Cesium.JulianDate | null>(null);
  const lookRef = useRef(look);
  const statusRef = useRef(onStatus);
  const speedRef = useRef(cameraSpeed);

  useEffect(() => {
    statusRef.current = onStatus;
  });

  useEffect(() => {
    speedRef.current = cameraSpeed;
  }, [cameraSpeed]);

  // Create the viewer once. Basemap and terrain are added after it exists.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (config.cesiumIonToken) Cesium.Ion.defaultAccessToken = config.cesiumIonToken;

    const created = new Cesium.Viewer(container, {
      baseLayer: false,
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });

    const { scene } = created;
    scene.globe.depthTestAgainstTerrain = true;
    startTimeRef.current = Cesium.JulianDate.clone(created.clock.currentTime);
    // Draw only when something changes. attachRenderQuality adds a heartbeat so nothing stalls.
    scene.requestRenderMode = true;

    setViewer(created);

    return () => {
      setImagery(null);
      setViewer(null);
      created.destroy();
    };
  }, []);

  useEffect(() => {
    onViewer(viewer);
  }, [viewer, onViewer]);

  // Imagery: USGS by default, no token needed.
  useEffect(() => {
    if (!viewer) return;
    let cancelled = false;
    statusRef.current({ imagery: 'loading' });

    Cesium.ArcGisMapServerImageryProvider.fromUrl(config.imageryUrl, {
      maximumLevel: MAX_IMAGERY_LEVEL,
    })
      .then((provider) => {
        if (cancelled || viewer.isDestroyed()) return;
        setImagery(viewer.imageryLayers.addImageryProvider(provider));
        statusRef.current({ imagery: 'ok' });
      })
      .catch(() => {
        if (!cancelled) statusRef.current({ imagery: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [viewer]);

  // Terrain: Cesium World Terrain with an ion token. Without one, open elevation tiles (no key).
  useEffect(() => {
    if (!viewer) return;
    if (!config.cesiumIonToken) {
      const provider = createOpenTerrain();
      viewer.terrainProvider = provider;
      statusRef.current({ terrain: 'open' });
      const stopListening = provider.errorEvent.addEventListener(() => statusRef.current({ terrain: 'error' }));
      return () => {
        stopListening();
      };
    }

    let cancelled = false;
    statusRef.current({ terrain: 'loading' });

    Cesium.createWorldTerrainAsync({ requestVertexNormals: true })
      .then((terrain) => {
        if (cancelled || viewer.isDestroyed()) return;
        viewer.terrainProvider = terrain;
        statusRef.current({ terrain: 'ion' });
      })
      .catch(() => {
        if (!cancelled) statusRef.current({ terrain: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [viewer]);

  // Map look: background, globe color, sun and sky, lighting, imagery, then every layer's colors.
  useEffect(() => {
    lookRef.current = look;
    if (!viewer) return;
    const { scene } = viewer;
    scene.backgroundColor = Cesium.Color.fromCssColorString(look.space);
    scene.globe.baseColor = Cesium.Color.fromCssColorString(look.globe);
    if (startTimeRef.current) applyDaylight(viewer, look.theme === 'light', startTimeRef.current);
    scene.globe.enableLighting = look.lighting; // Shading from the terrain gives the hillshade look.
    for (const handle of handlesRef.current.values()) handle.restyle(look);
    scene.requestRender();
  }, [viewer, look]);

  useEffect(() => {
    if (!imagery) return;
    const { show, saturation, brightness, contrast, alpha } = look.imagery;
    imagery.show = show;
    imagery.saturation = saturation;
    imagery.brightness = brightness;
    imagery.contrast = contrast;
    imagery.alpha = alpha;
    viewer?.scene.requestRender();
  }, [imagery, look, viewer]);

  useEffect(() => {
    if (!viewer) return;
    viewer.scene.verticalExaggeration = exaggeration;
    viewer.scene.requestRender();
  }, [viewer, exaggeration]);

  // Relief: hillshade drawn as an imagery layer on top of the (hidden) photo.
  const shadeColor = look.hillshade?.shadow;
  const highlightColor = look.hillshade?.highlight;
  useEffect(() => {
    if (!viewer || !shadeColor || !highlightColor) return;
    const layer = viewer.imageryLayers.addImageryProvider(
      createHillshade({ shadow: shadeColor, highlight: highlightColor }),
    );
    return () => {
      if (!viewer.isDestroyed()) viewer.imageryLayers.remove(layer, true);
    };
  }, [viewer, shadeColor, highlightColor]);

  // Mount layers once per viewer, after the label fonts are ready. Canvas labels need the font at creation.
  useEffect(() => {
    if (!viewer) return;
    let cancelled = false;
    const handles = handlesRef.current;
    const fontsReady = Promise.all(LABEL_FONTS.map((font) => document.fonts.load(font))).catch(() => undefined);

    void fontsReady.then(() => {
      if (cancelled || viewer.isDestroyed()) return;
      for (const layer of layers) handles.set(layer.id, layer.mount(viewer, lookRef.current));
      setMountedVersion((version) => version + 1);
    });

    return () => {
      cancelled = true;
      for (const handle of handles.values()) handle.destroy();
      handles.clear();
    };
  }, [viewer, layers]);

  useEffect(() => {
    if (!viewer) return;
    for (const layer of layers) {
      handlesRef.current.get(layer.id)?.show(visibility[layer.id] ?? layer.defaultVisible);
    }
    viewer.scene.requestRender();
  }, [viewer, layers, visibility, mountedVersion]);

  useEffect(() => {
    if (!viewer) return;
    return attachRenderQuality(viewer);
  }, [viewer]);

  // No drawing in a hidden tab. Starts again when the tab is shown.
  useEffect(() => {
    if (!viewer) return;
    return attachPauseWhenHidden(viewer);
  }, [viewer]);

  useEffect(() => {
    if (!viewer || cameraMode !== 'freefly') return;
    return attachFreeFly(viewer, () => speedRef.current);
  }, [viewer, cameraMode]);

  useEffect(() => {
    if (!viewer) return;
    const { lon, lat, range } = flyTo.place;
    // Center the place on screen, instead of putting the camera directly above it.
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat), 0),
      {
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), range),
        duration: 2.5,
      },
    );
    viewer.scene.requestRender();
  }, [viewer, flyTo]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
