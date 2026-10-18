import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { config, MAX_IMAGERY_LEVEL } from '../config';
import type { LayerHandle, MapLayer } from '../layers/types';
import { attachFreeFly } from './freeFly';
import { attachRenderQuality } from './renderQuality';
import type { Place } from './places';
import type { BasemapStyle, CameraMode, RuntimeStatus } from './types';

export interface FlyTarget {
  place: Place;
  /** Bump to fly again to the same place. */
  nonce: number;
}

export interface MapViewProps {
  layers: MapLayer[];
  visibility: Record<string, boolean>;
  basemap: BasemapStyle;
  exaggeration: number;
  cameraMode: CameraMode;
  /** Free-fly speed multiplier from the UI. Read every frame, so changing it does not restart free-fly. */
  cameraSpeed: number;
  flyTo: FlyTarget;
  onStatus: (status: Partial<RuntimeStatus>) => void;
}

const NAVY_GLOBE = '#0b1a2e';
const NAVY_SPACE = '#050d18';

// Blueprint: desaturated and dimmed imagery. Satellite: imagery as-is.
const IMAGERY_LOOK: Record<BasemapStyle, { saturation: number; brightness: number; contrast: number }> = {
  blueprint: { saturation: 0, brightness: 0.5, contrast: 1.25 },
  satellite: { saturation: 1, brightness: 1, contrast: 1 },
};

export function MapView({
  layers,
  visibility,
  basemap,
  exaggeration,
  cameraMode,
  cameraSpeed,
  flyTo,
  onStatus,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null);
  const [imagery, setImagery] = useState<Cesium.ImageryLayer | null>(null);
  const handlesRef = useRef(new Map<string, LayerHandle>());
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
    scene.backgroundColor = Cesium.Color.fromCssColorString(NAVY_SPACE);
    scene.globe.baseColor = Cesium.Color.fromCssColorString(NAVY_GLOBE);
    scene.globe.enableLighting = true; // Shading from the terrain gives a hillshade feel.
    scene.globe.depthTestAgainstTerrain = true;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    scene.globe.showGroundAtmosphere = false;
    // Draw only when something changes. attachRenderQuality adds a heartbeat so nothing stalls.
    scene.requestRenderMode = true;

    setViewer(created);

    return () => {
      setImagery(null);
      setViewer(null);
      created.destroy();
    };
  }, []);

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

  // Terrain: Cesium World Terrain when an ion token is set, otherwise flat.
  useEffect(() => {
    if (!viewer) return;
    if (!config.cesiumIonToken) {
      statusRef.current({ terrain: 'flat' });
      return;
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

  useEffect(() => {
    if (!imagery) return;
    const look = IMAGERY_LOOK[basemap];
    imagery.saturation = look.saturation;
    imagery.brightness = look.brightness;
    imagery.contrast = look.contrast;
    viewer?.scene.requestRender();
  }, [imagery, basemap, viewer]);

  useEffect(() => {
    if (!viewer) return;
    viewer.scene.verticalExaggeration = exaggeration;
    viewer.scene.requestRender();
  }, [viewer, exaggeration]);

  // Mount layers once per viewer. Visibility is applied in the next effect.
  useEffect(() => {
    if (!viewer) return;
    const handles = handlesRef.current;
    for (const layer of layers) handles.set(layer.id, layer.mount(viewer));
    return () => {
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
  }, [viewer, layers, visibility]);

  useEffect(() => {
    if (!viewer) return;
    return attachRenderQuality(viewer);
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
