import mapSchema from './schema.js';
import { selectedShapesSchema, surfaceSchema } from '../surface/schema.js';

const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const MAPLIBRE_SCRIPT_SRC = 'https://unpkg.com/maplibre-gl/dist/maplibre-gl.js';
const MAPLIBRE_CSS_HREF = 'https://unpkg.com/maplibre-gl/dist/maplibre-gl.css';
const DEFAULT_CENTER_X = 13.388;
const DEFAULT_CENTER_Y = 52.517;
const DEFAULT_ZOOM = 9.5;
const SELECTED_SHADOW = 'drop-shadow(0 0 3px rgba(0,0,0,0.4))';

const PAGE_REFERENCE_ZOOM = 14;
const PAGE_WORLD_SIZE = 512 * Math.pow(2, PAGE_REFERENCE_ZOOM);

let mapLibreLoadPromise = null;

export default function mount(element) {
  const rootRef = element.getOrCreate(mapSchema);
  const shapesRef = element.getOrCreate(surfaceSchema);
  const selectedShapesRef = element.getOrCreate(selectedShapesSchema);
  ensureMapDefaults(rootRef);

  let map = null;
  let resizeObserver = null;
  let disposeShapesSubscription = null;
  let disposeSelectedShapesSubscription = null;
  let exactLayoutFrameId = 0;
  let overlayMotionState = null;

  const cameraListeners = new Set();
  const shapeWrappers = new Map();

  const containerEl = document.createElement('div');
  containerEl.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:#e5e7eb;';

  const mapEl = document.createElement('div');
  mapEl.style.cssText = 'position:absolute;inset:0;z-index:0;pointer-events:none;cursor:default;';
  containerEl.appendChild(mapEl);

  const overlayRootEl = document.createElement('div');
  overlayRootEl.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;transform-origin:0 0;will-change:transform;';
  containerEl.appendChild(overlayRootEl);

  const shapeLayerEl = document.createElement('div');
  shapeLayerEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  overlayRootEl.appendChild(shapeLayerEl);

  const loadingEl = document.createElement('div');
  loadingEl.style.cssText = 'position:absolute;left:12px;top:12px;z-index:2;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.92);font:12px system-ui,-apple-system,sans-serif;color:#334155;pointer-events:none;';
  loadingEl.textContent = 'Loading map...';
  containerEl.appendChild(loadingEl);

  element.appendChild(containerEl);

  element.screenToPage = screenToPage;
  element.pageToScreen = pageToScreen;
  element.getCamera = getCamera;
  element.setCamera = setCamera;
  element.subscribeCamera = subscribeCamera;
  element.getContainerEl = getContainerEl;
  element.getScale = getScale;

  containerEl.addEventListener('wheel', onWheel);

  let visible = false;
  let intersectionObserver = null;

  resizeObserver = new ResizeObserver(() => {
    if (!map) return;
    map.resize();
    stopOverlayMotion();
    scheduleExactLayout();
  });
  resizeObserver.observe(containerEl);

  disposeShapesSubscription = shapesRef.subscribe(() => {
    scheduleExactLayout();
  });
  disposeSelectedShapesSubscription = selectedShapesRef.subscribe(() => {
    scheduleExactLayout();
  });

  intersectionObserver = new IntersectionObserver(
    (entries) => {
      const isVisible = entries[0].isIntersecting;
      if (isVisible && !visible) {
        visible = true;
        if (!map) void initializeMap();
      } else if (!isVisible && visible) {
        visible = false;
        destroyMap();
      }
    },
    { threshold: 0 },
  );
  intersectionObserver.observe(containerEl);

  return () => {
    cancelExactLayout();
    containerEl.removeEventListener('wheel', onWheel);
    if (intersectionObserver) {
      intersectionObserver.disconnect();
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    if (disposeShapesSubscription) {
      disposeShapesSubscription();
    }
    if (disposeSelectedShapesSubscription) {
      disposeSelectedShapesSubscription();
    }
    clearShapeWrappers(shapeWrappers);
    if (map) {
      map.remove();
    }
    delete element.screenToPage;
    delete element.pageToScreen;
    delete element.getCamera;
    delete element.setCamera;
    delete element.subscribeCamera;
    delete element.getContainerEl;
    delete element.getScale;
    containerEl.remove();
  };

  async function initializeMap() {
    try {
      const mapLibre = await loadMapLibre();
      if (!visible) return;
      const geo = readGeoCamera(rootRef);
      map = new mapLibre.Map({
        container: mapEl,
        style: MAP_STYLE_URL,
        center: [geo.lng, geo.lat],
        zoom: geo.zoom,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: false,
      });
      map.dragPan.disable();
      map.scrollZoom.disable();
      map.boxZoom.disable();
      map.doubleClickZoom.disable();
      map.touchZoomRotate.disable();
      map.on('load', onMapLoad);
      map.on('movestart', onMapMoveStart);
      map.on('move', onMapMove);
      map.on('render', onMapRender);
      map.on('moveend', onMapMoveEnd);
      map.on('resize', onMapResize);
      map.on('remove', onMapRemove);
    } catch (error) {
      loadingEl.textContent = `Map failed to load: ${error instanceof Error ? error.message : String(error)}`;
      loadingEl.style.background = 'rgba(254,242,242,0.96)';
      loadingEl.style.color = '#b91c1c';
    }
  }

  function screenToPage(clientX, clientY) {
    const rect = containerEl.getBoundingClientRect();
    if (!map) {
      const geo = readGeoCamera(rootRef);
      return { x: lngToPageX(geo.lng), y: latToPageY(geo.lat) };
    }
    const scaleX = containerEl.offsetWidth ? rect.width / containerEl.offsetWidth : 1;
    const scaleY = containerEl.offsetHeight ? rect.height / containerEl.offsetHeight : 1;
    const lngLat = map.unproject([(clientX - rect.left) / scaleX, (clientY - rect.top) / scaleY]);
    return { x: lngToPageX(lngLat.lng), y: latToPageY(lngLat.lat) };
  }

  function pageToScreen(pageX, pageY) {
    const rect = containerEl.getBoundingClientRect();
    if (!map) {
      return { x: rect.left, y: rect.top };
    }
    const scaleX = containerEl.offsetWidth ? rect.width / containerEl.offsetWidth : 1;
    const scaleY = containerEl.offsetHeight ? rect.height / containerEl.offsetHeight : 1;
    const point = map.project([pageXToLng(pageX), pageYToLat(pageY)]);
    return { x: point.x * scaleX + rect.left, y: point.y * scaleY + rect.top };
  }

  function getCamera() {
    if (map) {
      const center = map.getCenter();
      return {
        x: -lngToPageX(center.lng),
        y: -latToPageY(center.lat),
        zoom: Math.pow(2, map.getZoom() - PAGE_REFERENCE_ZOOM),
      };
    }
    const geo = readGeoCamera(rootRef);
    return {
      x: -lngToPageX(geo.lng),
      y: -latToPageY(geo.lat),
      zoom: Math.pow(2, geo.zoom - PAGE_REFERENCE_ZOOM),
    };
  }

  function setCamera(camera) {
    const currentCamera = getCamera();
    const nextOffsetX = typeof camera?.x === 'number' ? camera.x : currentCamera.x;
    const nextOffsetY = typeof camera?.y === 'number' ? camera.y : currentCamera.y;
    const nextZoom = typeof camera?.zoom === 'number' ? camera.zoom : currentCamera.zoom;
    const geoLng = pageXToLng(-nextOffsetX);
    const geoLat = pageYToLat(-nextOffsetY);
    const mapZoom = Math.log2(nextZoom) + PAGE_REFERENCE_ZOOM;
    persistGeoCamera(rootRef, { lng: geoLng, lat: geoLat, zoom: mapZoom });
    if (map) {
      stopOverlayMotion();
      map.jumpTo({ center: [geoLng, geoLat], zoom: mapZoom });
      emitCameraChange(cameraListeners, { x: nextOffsetX, y: nextOffsetY, zoom: nextZoom });
      scheduleExactLayout();
    }
  }

  function subscribeCamera(listener) {
    listener(getCamera());
    cameraListeners.add(listener);
    return () => {
      cameraListeners.delete(listener);
    };
  }

  function getContainerEl() {
    return containerEl;
  }

  function getScale() {
    const rect = containerEl.getBoundingClientRect();
    const ancestorScale = containerEl.offsetWidth ? rect.width / containerEl.offsetWidth : 1;
    return (getCamera()?.zoom ?? 1) * ancestorScale;
  }

  function onMapLoad() {
    loadingEl.remove();
    scheduleExactLayout();
    emitCameraChange(cameraListeners, getCamera());
  }

  function onMapMoveStart() {
    flushExactLayout();
    if (!map) return;
    overlayMotionState = createOverlayMotionState(map, containerEl);
  }

  function onMapMove() {
    emitCameraChange(cameraListeners, getCamera());
  }

  function onMapRender() {
    if (!map || !overlayMotionState) return;
    applyOverlayMotionTransform(overlayRootEl, map, overlayMotionState);
  }

  function onMapMoveEnd() {
    stopOverlayMotion();
    if (map) {
      const center = map.getCenter();
      persistGeoCamera(rootRef, { lng: center.lng, lat: center.lat, zoom: map.getZoom() });
    }
    scheduleExactLayout();
  }

  function onMapResize() {
    stopOverlayMotion();
    scheduleExactLayout();
  }

  function onMapRemove() {
    stopOverlayMotion();
    map = null;
  }

  function destroyMap() {
    cancelExactLayout();
    stopOverlayMotion();
    clearShapeWrappers(shapeWrappers);
    if (map) {
      map.remove();
    }
  }

  function onWheel(event) {
    event.stopPropagation();
  }

  function scheduleExactLayout() {
    if (!map || exactLayoutFrameId) return;
    exactLayoutFrameId = requestAnimationFrame(() => {
      exactLayoutFrameId = 0;
      runExactLayout();
    });
  }

  function runExactLayout() {
    if (!map) return;
    resetOverlayTransform(overlayRootEl);
    syncShapeWrappers(
      shapeLayerEl,
      shapeWrappers,
      map,
      shapesRef.value() ?? {},
      selectedShapesRef.value() ?? {},
      element,
    );
  }

  function flushExactLayout() {
    if (!map) return;
    if (exactLayoutFrameId) {
      cancelAnimationFrame(exactLayoutFrameId);
      exactLayoutFrameId = 0;
    }
    runExactLayout();
  }

  function cancelExactLayout() {
    if (!exactLayoutFrameId) return;
    cancelAnimationFrame(exactLayoutFrameId);
    exactLayoutFrameId = 0;
  }

  function stopOverlayMotion() {
    overlayMotionState = null;
  }
}

function ensureMapDefaults(rootRef) {
  rootRef.change((documentValue) => {
    if (typeof documentValue.centerX !== 'number') {
      documentValue.centerX = DEFAULT_CENTER_X;
    }
    if (typeof documentValue.centerY !== 'number') {
      documentValue.centerY = DEFAULT_CENTER_Y;
    }
    if (typeof documentValue.zoom !== 'number') {
      documentValue.zoom = DEFAULT_ZOOM;
    }
  });
}

function readGeoCamera(rootRef) {
  const value = rootRef.value() ?? {};
  return {
    lng: typeof value.centerX === 'number' ? value.centerX : DEFAULT_CENTER_X,
    lat: typeof value.centerY === 'number' ? value.centerY : DEFAULT_CENTER_Y,
    zoom: typeof value.zoom === 'number' ? value.zoom : DEFAULT_ZOOM,
  };
}

function persistGeoCamera(rootRef, geo) {
  rootRef.change((documentValue) => {
    documentValue.centerX = geo.lng;
    documentValue.centerY = geo.lat;
    documentValue.zoom = geo.zoom;
  });
}

function emitCameraChange(cameraListeners, camera) {
  for (const listener of cameraListeners) {
    listener(camera);
  }
}

function lngToPageX(lng) {
  return ((lng + 180) / 360) * PAGE_WORLD_SIZE;
}

function pageXToLng(pageX) {
  return (pageX / PAGE_WORLD_SIZE) * 360 - 180;
}

function latToPageY(lat) {
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * PAGE_WORLD_SIZE;
}

function pageYToLat(pageY) {
  const n = Math.PI - (2 * Math.PI * pageY) / PAGE_WORLD_SIZE;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

function createOverlayMotionState(map, containerEl) {
  const rect = containerEl.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const basisOffset = Math.max(120, Math.min(rect.width, rect.height) / 4);
  const basisScreenPoints = [
    { x: centerX, y: centerY },
    { x: centerX + basisOffset, y: centerY },
    { x: centerX, y: centerY + basisOffset },
  ];
  const basisGeoPoints = basisScreenPoints.map((point) => {
    const lngLat = map.unproject([point.x, point.y]);
    return {
      screenX: point.x,
      screenY: point.y,
      lng: lngLat.lng,
      lat: lngLat.lat,
    };
  });
  return {
    camera: {
      x: map.getCenter().lng,
      y: map.getCenter().lat,
      zoom: map.getZoom(),
    },
    basisGeoPoints,
  };
}

function applyOverlayMotionTransform(overlayRootEl, map, overlayMotionState) {
  const [origin, horizontal, vertical] = overlayMotionState.basisGeoPoints;
  const projectedOrigin = projectLngLat(map, origin.lng, origin.lat);
  const projectedHorizontal = projectLngLat(map, horizontal.lng, horizontal.lat);
  const projectedVertical = projectLngLat(map, vertical.lng, vertical.lat);
  if (!projectedOrigin || !projectedHorizontal || !projectedVertical) {
    resetOverlayTransform(overlayRootEl);
    return;
  }

  const horizontalSpan = horizontal.screenX - origin.screenX || 1;
  const verticalSpan = vertical.screenY - origin.screenY || 1;
  const a = (projectedHorizontal.x - projectedOrigin.x) / horizontalSpan;
  const b = (projectedHorizontal.y - projectedOrigin.y) / horizontalSpan;
  const c = (projectedVertical.x - projectedOrigin.x) / verticalSpan;
  const d = (projectedVertical.y - projectedOrigin.y) / verticalSpan;
  const e = projectedOrigin.x - a * origin.screenX - c * origin.screenY;
  const f = projectedOrigin.y - b * origin.screenX - d * origin.screenY;
  overlayRootEl.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
}

function resetOverlayTransform(overlayRootEl) {
  overlayRootEl.style.transform = '';
}

function syncShapeWrappers(shapeLayerEl, shapeWrappers, map, shapes, selectedShapes, element) {
  const activeIds = new Set(Object.keys(shapes));
  for (const [shapeId, wrapper] of shapeWrappers) {
    if (!activeIds.has(shapeId)) {
      wrapper.remove();
      shapeWrappers.delete(shapeId);
    }
  }

  for (const shapeId of activeIds) {
    const shape = shapes[shapeId];
    let wrapper = shapeWrappers.get(shapeId);
    if (!wrapper) {
      wrapper = createShapeWrapper(shapeId, shapeLayerEl, element);
      shapeWrappers.set(shapeId, wrapper);
    }
    updateShapeWrapper(wrapper, shapeId, shape, selectedShapes[shapeId], map);
  }
}

function createShapeWrapper(shapeId, shapeLayerEl, element) {
  const wrapper = document.createElement('div');
  wrapper.dataset.shapeId = shapeId;
  wrapper.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;transform-origin:0 0;pointer-events:auto;will-change:transform;';

  const shapeEl = document.createElement('ref-view');
  shapeEl.style.cssText = 'display:block;transform-origin:0 0;';
  shapeEl.setAttribute('ref-url', element.getOrCreate(surfaceSchema).at(shapeId).url);
  wrapper.appendChild(shapeEl);

  shapeLayerEl.appendChild(wrapper);
  return wrapper;
}

function updateShapeWrapper(wrapper, shapeId, shape, isSelected, map) {
  if (!shape || typeof shape.x !== 'number' || typeof shape.y !== 'number' || typeof shape.viewUrl !== 'string') {
    wrapper.style.display = 'none';
    return;
  }

  const shapeEl = wrapper.firstElementChild;
  if (!(shapeEl instanceof HTMLElement)) return;
  shapeEl.setAttribute('view-url', shape.viewUrl);

  if (typeof shape.width === 'number') shapeEl.style.width = `${shape.width}px`;
  if (typeof shape.height === 'number') shapeEl.style.height = `${shape.height}px`;

  const localBounds = getLocalBounds(shape);
  const projectedFrame = projectShapeFrame(map, shape, localBounds);
  if (!projectedFrame) {
    wrapper.style.display = 'none';
    return;
  }
  wrapper.style.display = '';
  wrapper.style.left = `${projectedFrame.originX}px`;
  wrapper.style.top = `${projectedFrame.originY}px`;
  const shapeScale = shape.scale ?? 1;
  wrapper.style.transform = `scale(${projectedFrame.scaleX * shapeScale}, ${projectedFrame.scaleY * shapeScale})`;
  wrapper.style.zIndex = `${shape.z ?? 0}`;
  wrapper.style.filter = isSelected ? SELECTED_SHADOW : 'none';
  shapeEl.style.transform = `translate(${projectedFrame.offsetX}px, ${projectedFrame.offsetY}px)`;
}

function getLocalBounds(shape) {
  if (typeof shape.width === 'number' || typeof shape.height === 'number') {
    const width = typeof shape.width === 'number' ? shape.width : 0;
    const height = typeof shape.height === 'number' ? shape.height : 0;
    return {
      minX: 0,
      minY: 0,
      maxX: width,
      maxY: height,
    };
  }

  if (Array.isArray(shape.points) && shape.points.length > 0) {
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    for (const point of shape.points) {
      if (!Array.isArray(point)) continue;
      const localX = Number(point[0]);
      const localY = Number(point[1]);
      if (!Number.isFinite(localX) || !Number.isFinite(localY)) continue;
      if (localX < minX) minX = localX;
      if (localY < minY) minY = localY;
      if (localX > maxX) maxX = localX;
      if (localY > maxY) maxY = localY;
    }
    return { minX, minY, maxX, maxY };
  }

  return null;
}

function projectShapeFrame(map, shape, localBounds) {
  const anchorPoint = projectLngLat(map, pageXToLng(shape.x), pageYToLat(shape.y));
  if (!anchorPoint) {
    return null;
  }

  if (!localBounds) {
    return {
      originX: anchorPoint.x,
      originY: anchorPoint.y,
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
    };
  }

  const boundsOriginPoint = projectLngLat(
    map,
    pageXToLng(shape.x + localBounds.minX),
    pageYToLat(shape.y + localBounds.minY),
  );
  const horizontalReferencePoint = projectLngLat(
    map,
    pageXToLng(shape.x + localBounds.maxX),
    pageYToLat(shape.y + localBounds.minY),
  );
  const verticalReferencePoint = projectLngLat(
    map,
    pageXToLng(shape.x + localBounds.minX),
    pageYToLat(shape.y + localBounds.maxY),
  );
  const localWidth = localBounds.maxX - localBounds.minX;
  const localHeight = localBounds.maxY - localBounds.minY;

  if (!boundsOriginPoint || !horizontalReferencePoint || !verticalReferencePoint) {
    return {
      originX: anchorPoint.x,
      originY: anchorPoint.y,
      scaleX: 1,
      scaleY: 1,
      offsetX: -localBounds.minX,
      offsetY: -localBounds.minY,
    };
  }

  const rawScaleX = localWidth !== 0 ? (horizontalReferencePoint.x - boundsOriginPoint.x) / localWidth : 0;
  const rawScaleY = localHeight !== 0 ? (verticalReferencePoint.y - boundsOriginPoint.y) / localHeight : 0;

  return {
    originX: boundsOriginPoint.x,
    originY: boundsOriginPoint.y,
    scaleX: rawScaleX || rawScaleY || 1,
    scaleY: rawScaleY || rawScaleX || 1,
    offsetX: -localBounds.minX,
    offsetY: -localBounds.minY,
  };
}

function projectLngLat(map, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (y < -90 || y > 90) return null;
  try {
    return map.project([x, y]);
  } catch {
    return null;
  }
}

function clearShapeWrappers(shapeWrappers) {
  for (const [, wrapper] of shapeWrappers) {
    wrapper.remove();
  }
  shapeWrappers.clear();
}

function loadMapLibre() {
  if (globalThis.maplibregl) {
    ensureMapLibreStylesheet();
    return Promise.resolve(globalThis.maplibregl);
  }
  if (!mapLibreLoadPromise) {
    ensureMapLibreStylesheet();
    mapLibreLoadPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${MAPLIBRE_SCRIPT_SRC}"]`);
      if (existingScript) {
        existingScript.addEventListener('load', onLoad, { once: true });
        existingScript.addEventListener('error', onError, { once: true });
        if (globalThis.maplibregl) {
          resolve(globalThis.maplibregl);
        }
        return;
      }

      const scriptEl = document.createElement('script');
      scriptEl.src = MAPLIBRE_SCRIPT_SRC;
      scriptEl.async = true;
      scriptEl.addEventListener('load', onLoad, { once: true });
      scriptEl.addEventListener('error', onError, { once: true });
      document.head.appendChild(scriptEl);

      function onLoad() {
        if (globalThis.maplibregl) {
          resolve(globalThis.maplibregl);
        } else {
          reject(new Error('MapLibre loaded without exposing maplibregl'));
        }
      }

      function onError() {
        reject(new Error('Unable to load MapLibre'));
      }
    });
  }
  return mapLibreLoadPromise;
}

function ensureMapLibreStylesheet() {
  if (document.querySelector(`link[href="${MAPLIBRE_CSS_HREF}"]`)) return;
  const linkEl = document.createElement('link');
  linkEl.rel = 'stylesheet';
  linkEl.href = MAPLIBRE_CSS_HREF;
  document.head.appendChild(linkEl);
}
