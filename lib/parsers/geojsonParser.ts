import { FeatureCollection, Feature, Point, LineString } from 'geojson';
import { SewerAsset } from '../types';

export function parseGeoJSON(data: string | FeatureCollection): SewerAsset[] {
  let geojson: FeatureCollection;

  if (typeof data === 'string') {
    try {
      geojson = JSON.parse(data);
    } catch (error) {
      throw new Error('Invalid GeoJSON format: ' + (error as Error).message);
    }
  } else {
    geojson = data;
  }

  if (!geojson.type || geojson.type !== 'FeatureCollection') {
    throw new Error('GeoJSON must be a FeatureCollection');
  }

  if (!Array.isArray(geojson.features)) {
    throw new Error('GeoJSON features must be an array');
  }

  const assets: SewerAsset[] = geojson.features
    .filter((feature: Feature) => {
      const geometry = feature.geometry;
      return (
        geometry.type === 'Point' ||
        geometry.type === 'LineString' ||
        geometry.type === 'MultiLineString'
      );
    })
    .map((feature) => {
      const geometry = feature.geometry;
      if (geometry.type !== 'Point' && geometry.type !== 'LineString' && geometry.type !== 'MultiLineString') {
        return null;
      }
      return {
      ...feature,
        properties: {
          ...feature.properties,
          // Preserve FID if it exists (primary identifier for matching)
          FID: feature.properties?.FID || feature.properties?.fid || feature.properties?.Fid,
          // Also set id for compatibility
          id: feature.properties?.FID || feature.properties?.fid || feature.properties?.Fid || 
              feature.properties?.id || feature.properties?.assetId || 
              `asset-${Math.random().toString(36).substr(2, 9)}`,
        },
      } as SewerAsset;
    })
    .filter((asset): asset is SewerAsset => asset !== null);

  return assets;
}

export function validateGeoJSON(data: any): boolean {
  try {
    const geojson = typeof data === 'string' ? JSON.parse(data) : data;
    return (
      geojson.type === 'FeatureCollection' &&
      Array.isArray(geojson.features)
    );
  } catch {
    return false;
  }
}

