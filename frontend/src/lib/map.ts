import { useEffect, useRef, useState } from "react";

export type GeoBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export type TileSpec = {
  key: string;
  src: string;
  left: number;
  top: number;
};

export type MapLayout = {
  tiles: TileSpec[];
  originX: number;
  originY: number;
  zoom: number;
  width: number;
  height: number;
};

const TILE_SIZE = 256;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const projectWebMercator = (lat: number, lng: number, zoom: number) => {
  const limitedLat = clamp(lat, -85.05112878, 85.05112878);
  const sinLat = Math.sin((limitedLat * Math.PI) / 180);
  const worldSize = TILE_SIZE * 2 ** zoom;

  return {
    x: ((lng + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
  };
};

export const getTileUrl = (zoom: number, x: number, y: number) => {
  const limit = 2 ** zoom;
  if (y < 0 || y >= limit) {
    return null;
  }

  const wrappedX = ((x % limit) + limit) % limit;
  return `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;
};

const chooseZoom = (bounds: GeoBounds, width: number, height: number, padding: number) => {
  for (let zoom = 18; zoom >= 5; zoom -= 1) {
    const northWest = projectWebMercator(bounds.north, bounds.west, zoom);
    const southEast = projectWebMercator(bounds.south, bounds.east, zoom);
    const viewportWidth = southEast.x - northWest.x;
    const viewportHeight = southEast.y - northWest.y;

    if (viewportWidth <= width - padding * 2 && viewportHeight <= height - padding * 2) {
      return zoom;
    }
  }

  return 5;
};

export const buildMapLayout = (
  bounds: GeoBounds,
  width: number,
  height: number,
  padding = 8,
): MapLayout | null => {
  if (width < 32 || height < 32) {
    return null;
  }

  const zoom = chooseZoom(bounds, width, height, padding);
  const northWest = projectWebMercator(bounds.north, bounds.west, zoom);
  const southEast = projectWebMercator(bounds.south, bounds.east, zoom);
  const viewportWidth = southEast.x - northWest.x;
  const viewportHeight = southEast.y - northWest.y;
  const extraX = Math.max(0, width - viewportWidth);
  const extraY = Math.max(0, height - viewportHeight);
  const originX = northWest.x - extraX / 2;
  const originY = northWest.y - extraY / 2;
  const endX = originX + width;
  const endY = originY + height;

  const tileStartX = Math.floor(originX / TILE_SIZE);
  const tileEndX = Math.floor((endX - 1) / TILE_SIZE);
  const tileStartY = Math.floor(originY / TILE_SIZE);
  const tileEndY = Math.floor((endY - 1) / TILE_SIZE);

  const tiles: TileSpec[] = [];
  for (let tileY = tileStartY; tileY <= tileEndY; tileY += 1) {
    for (let tileX = tileStartX; tileX <= tileEndX; tileX += 1) {
      const src = getTileUrl(zoom, tileX, tileY);
      if (!src) {
        continue;
      }

      tiles.push({
        key: `${zoom}-${tileX}-${tileY}`,
        src,
        left: tileX * TILE_SIZE - originX,
        top: tileY * TILE_SIZE - originY,
      });
    }
  }

  return {
    tiles,
    originX,
    originY,
    zoom,
    width,
    height,
  };
};

export const projectPointToLayout = (layout: MapLayout, lat: number, lng: number) => {
  const point = projectWebMercator(lat, lng, layout.zoom);
  return {
    x: point.x - layout.originX,
    y: point.y - layout.originY,
  };
};

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const update = () => {
      setSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return { ref, size };
}
