import { FeatureCollection, Feature, Point, LineString } from 'geojson';
import { LateralInspection, TapInspection } from '../types';
import { validateCoordinates } from './coordinateValidation';

/**
 * Get a reference point from asset coordinates (for creating line from asset to lateral)
 */
function getAssetReferencePoint(lateral: LateralInspection): [number, number] | null {
  // If assetCoordinates is provided, use it
  if (lateral.assetCoordinates) {
    const validated = validateCoordinates(lateral.assetCoordinates);
    return validated;
  }
  
  // Otherwise, we can't create a line - return null
  return null;
}

/**
 * Convert lateral inspections to GeoJSON FeatureCollection
 * Creates LineString features from asset to lateral point (small lines)
 */
export function lateralsToGeoJSON(laterals: LateralInspection[]): FeatureCollection<LineString | Point> {
  console.log(`[GeoJSON Export] Starting conversion of ${laterals.length} laterals`);
  
  let validCount = 0;
  let skippedCount = 0;
  const coordinateStats = {
    minLat: Infinity,
    maxLat: -Infinity,
    minLng: Infinity,
    maxLng: -Infinity,
    invalidCoords: [] as Array<{ id: string; original: [number, number]; validated: [number, number] | null; reason: string }>,
  };
  
  const features: Feature<LineString | Point>[] = laterals
    .map((lateral): Feature<LineString | Point> | null => {
      // Log original coordinates
      const originalCoords = lateral.coordinates;
      console.log(`[GeoJSON Export] Processing lateral ${lateral.id}:`, {
        original: originalCoords,
        assetCoords: lateral.assetCoordinates,
      });
      
      // Validate coordinates - this is the final validation before export
      const lateralCoords = validateCoordinates(lateral.coordinates);
      if (!lateralCoords) {
        console.warn(`[GeoJSON Export] Skipping lateral ${lateral.id} due to invalid coordinates:`, originalCoords);
        skippedCount++;
        coordinateStats.invalidCoords.push({
          id: lateral.id,
          original: originalCoords,
          validated: null,
          reason: 'Validation returned null',
        });
        return null;
      }
      
      // Log validated coordinates
      console.log(`[GeoJSON Export] Lateral ${lateral.id} coordinates:`, {
        original: originalCoords,
        validated: lateralCoords,
        swapped: originalCoords[0] !== lateralCoords[0] || originalCoords[1] !== lateralCoords[1],
      });
      
      // Final safety check: ensure latitude is valid
      if (lateralCoords[1] < -90 || lateralCoords[1] > 90) {
        console.error(`[GeoJSON Export] CRITICAL: Lateral ${lateral.id} has invalid latitude ${lateralCoords[1]} after validation. Original:`, originalCoords);
        skippedCount++;
        coordinateStats.invalidCoords.push({
          id: lateral.id,
          original: originalCoords,
          validated: lateralCoords,
          reason: `Invalid latitude: ${lateralCoords[1]}`,
        });
        return null;
      }
      
      // Update coordinate statistics
      coordinateStats.minLat = Math.min(coordinateStats.minLat, lateralCoords[1]);
      coordinateStats.maxLat = Math.max(coordinateStats.maxLat, lateralCoords[1]);
      coordinateStats.minLng = Math.min(coordinateStats.minLng, lateralCoords[0]);
      coordinateStats.maxLng = Math.max(coordinateStats.maxLng, lateralCoords[0]);
      
      // Use stub line if available (preferred method - 3ft perpendicular stub)
      let geometry: LineString | Point;
      
      if (lateral.stubLine && lateral.stubLine.length === 2) {
        // Validate stub line coordinates
        const validatedStubStart = validateCoordinates(lateral.stubLine[0]);
        const validatedStubEnd = validateCoordinates(lateral.stubLine[1]);
        
        if (validatedStubStart && validatedStubEnd) {
          // Final check on stub line coordinates
          if (validatedStubStart[1] >= -90 && validatedStubStart[1] <= 90 && 
              validatedStubEnd[1] >= -90 && validatedStubEnd[1] <= 90) {
            geometry = {
              type: 'LineString',
              coordinates: [validatedStubStart, validatedStubEnd],
            };
            console.log(`[GeoJSON Export] Created stub LineString for lateral ${lateral.id} with coordinates:`, {
              start: validatedStubStart,
              end: validatedStubEnd,
            });
          } else {
            console.error(`[GeoJSON Export] CRITICAL: Stub line has invalid latitude for lateral ${lateral.id}`);
            geometry = {
              type: 'Point',
              coordinates: lateralCoords,
            };
          }
        } else {
          console.warn(`[GeoJSON Export] Invalid stub line coordinates for lateral ${lateral.id}, falling back to point`);
          geometry = {
            type: 'Point',
            coordinates: lateralCoords,
          };
        }
      } else {
        // Fall back to old behavior: line from asset reference point to lateral point
        const assetRefPoint = getAssetReferencePoint(lateral);
        
        if (assetRefPoint) {
          // Log asset coordinates
          console.log(`[GeoJSON Export] Lateral ${lateral.id} asset reference point:`, {
            original: lateral.assetCoordinates,
            validated: assetRefPoint,
          });
          
          // Final check on asset coordinates too
          if (assetRefPoint[1] < -90 || assetRefPoint[1] > 90) {
            console.error(`[GeoJSON Export] CRITICAL: Asset reference point has invalid latitude ${assetRefPoint[1]} for lateral ${lateral.id}`);
            // Fall back to Point instead of LineString
            geometry = {
              type: 'Point',
              coordinates: lateralCoords,
            };
          } else {
            geometry = {
              type: 'LineString',
              coordinates: [assetRefPoint, lateralCoords], // Both points validated
            };
            console.log(`[GeoJSON Export] Created LineString (fallback) for lateral ${lateral.id} with coordinates:`, {
              start: assetRefPoint,
              end: lateralCoords,
            });
          }
        } else {
          geometry = {
            type: 'Point',
            coordinates: lateralCoords,
          };
          console.log(`[GeoJSON Export] Created Point for lateral ${lateral.id} with coordinates:`, lateralCoords);
        }
      }
      
      validCount++;
      
      return {
        type: 'Feature',
        geometry,
        properties: {
          id: lateral.id,
          assetId: lateral.assetId,
          pipeSegmentReference: lateral.properties?.pipeSegmentReference,
          tapDistance: lateral.tapDistance,
          clockPosition: lateral.clockPosition,
          address: lateral.address,
          ...lateral.addressDetails,
          inspectionDate: lateral.inspectionDate,
          // Include all other properties from the inspection
          ...lateral.properties,
        },
      };
    })
    .filter((feature): feature is Feature<LineString | Point> => feature !== null);

  // Log summary statistics
  console.log(`[GeoJSON Export] Conversion complete:`, {
    total: laterals.length,
    valid: validCount,
    skipped: skippedCount,
    coordinateRanges: {
      latitude: { min: coordinateStats.minLat, max: coordinateStats.maxLat },
      longitude: { min: coordinateStats.minLng, max: coordinateStats.maxLng },
    },
    invalidCoordinates: coordinateStats.invalidCoords.length > 0 ? coordinateStats.invalidCoords : 'None',
  });

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Download GeoJSON as a file
 */
export function downloadGeoJSON(geojson: FeatureCollection, filename: string = 'lateral-inspections.geojson'): void {
  const jsonString = JSON.stringify(geojson, null, 2);
  const blob = new Blob([jsonString], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Convert tap inspections to GeoJSON FeatureCollection
 */
export function tapsToGeoJSON(taps: TapInspection[]): FeatureCollection<Point> {
  const features: Feature<Point>[] = taps
    .map((tap): Feature<Point> | null => {
      // Validate coordinates before export
      const validatedCoords = validateCoordinates(tap.coordinates);
      if (!validatedCoords) {
        console.warn(`Skipping tap ${tap.id} due to invalid coordinates`);
        return null;
      }
      
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: validatedCoords,
        },
        properties: {
          id: tap.id,
          assetId: tap.assetId,
          pipeSegmentReference: tap.pipeSegmentReference,
          inspectionId: tap.inspectionId,
          defectCode: tap.defectCode,
          distance: tap.distance,
          clockPosition: tap.clockPosition,
          address: tap.address,
          ...tap.addressDetails,
          inspectionDate: tap.inspectionDate,
          // Include all other properties
          ...tap.properties,
        },
      };
    })
    .filter((feature): feature is Feature<Point> => feature !== null);

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Validate a GeoJSON FeatureCollection and return a detailed report
 */
export function validateGeoJSONExport(geojson: FeatureCollection): {
  isValid: boolean;
  errors: Array<{ featureId: string; error: string; coordinates: any }>;
  warnings: Array<{ featureId: string; warning: string; coordinates: any }>;
  statistics: {
    totalFeatures: number;
    pointFeatures: number;
    lineStringFeatures: number;
    coordinateRanges: {
      latitude: { min: number; max: number };
      longitude: { min: number; max: number };
    };
  };
} {
  const errors: Array<{ featureId: string; error: string; coordinates: any }> = [];
  const warnings: Array<{ featureId: string; warning: string; coordinates: any }> = [];
  let pointCount = 0;
  let lineStringCount = 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  geojson.features.forEach((feature, index) => {
    const featureId = feature.properties?.id || `feature-${index}`;
    const geometry = feature.geometry;

    if (geometry.type === 'Point') {
      pointCount++;
      const coords = geometry.coordinates;
      
      if (!Array.isArray(coords) || coords.length < 2) {
        errors.push({
          featureId,
          error: 'Invalid coordinate array',
          coordinates: coords,
        });
        return;
      }

      const [lng, lat] = coords;

      // Check for NaN
      if (isNaN(lng) || isNaN(lat)) {
        errors.push({
          featureId,
          error: 'Coordinates contain NaN',
          coordinates: coords,
        });
        return;
      }

      // Check latitude range
      if (lat < -90 || lat > 90) {
        errors.push({
          featureId,
          error: `Invalid latitude: ${lat} (must be between -90 and 90)`,
          coordinates: coords,
        });
      }

      // Check longitude range
      if (lng < -180 || lng > 180) {
        warnings.push({
          featureId,
          warning: `Longitude ${lng} outside standard range (will be wrapped)`,
          coordinates: coords,
        });
      }

      // Update statistics
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    } else if (geometry.type === 'LineString') {
      lineStringCount++;
      const coordsArray = geometry.coordinates;

      if (!Array.isArray(coordsArray) || coordsArray.length < 2) {
        errors.push({
          featureId,
          error: 'Invalid LineString coordinates array',
          coordinates: coordsArray,
        });
        return;
      }

      coordsArray.forEach((coords, pointIndex) => {
        if (!Array.isArray(coords) || coords.length < 2) {
          errors.push({
            featureId,
            error: `Invalid coordinate at point ${pointIndex}`,
            coordinates: coords,
          });
          return;
        }

        const [lng, lat] = coords;

        // Check for NaN
        if (isNaN(lng) || isNaN(lat)) {
          errors.push({
            featureId,
            error: `Point ${pointIndex} contains NaN`,
            coordinates: coords,
          });
          return;
        }

        // Check latitude range
        if (lat < -90 || lat > 90) {
          errors.push({
            featureId,
            error: `Point ${pointIndex} has invalid latitude: ${lat} (must be between -90 and 90)`,
            coordinates: coords,
          });
        }

        // Check longitude range
        if (lng < -180 || lng > 180) {
          warnings.push({
            featureId,
            warning: `Point ${pointIndex} longitude ${lng} outside standard range`,
            coordinates: coords,
          });
        }

        // Update statistics
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      });
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    statistics: {
      totalFeatures: geojson.features.length,
      pointFeatures: pointCount,
      lineStringFeatures: lineStringCount,
      coordinateRanges: {
        latitude: { min: minLat === Infinity ? 0 : minLat, max: maxLat === -Infinity ? 0 : maxLat },
        longitude: { min: minLng === Infinity ? 0 : minLng, max: maxLng === -Infinity ? 0 : maxLng },
      },
    },
  };
}

/**
 * Diagnose GeoJSON and return detailed analysis
 * Can be called from browser console for debugging
 */
export function diagnoseGeoJSON(laterals: LateralInspection[]): {
  input: {
    totalLaterals: number;
    sampleCoordinates: Array<{ id: string; coordinates: [number, number]; assetCoordinates?: [number, number] }>;
  };
  export: {
    geojson: FeatureCollection<LineString | Point>;
    validation: ReturnType<typeof validateGeoJSONExport>;
  };
} {
  console.log('[GeoJSON Diagnosis] Starting diagnosis...');
  
  const geojson = lateralsToGeoJSON(laterals);
  const validation = validateGeoJSONExport(geojson);
  
  const diagnosis = {
    input: {
      totalLaterals: laterals.length,
      sampleCoordinates: laterals.slice(0, 5).map(l => ({
        id: l.id,
        coordinates: l.coordinates,
        assetCoordinates: l.assetCoordinates,
      })),
    },
    export: {
      geojson,
      validation,
    },
  };

  console.log('[GeoJSON Diagnosis] Results:', diagnosis);
  console.log('[GeoJSON Diagnosis] Validation Summary:', {
    isValid: validation.isValid,
    errorCount: validation.errors.length,
    warningCount: validation.warnings.length,
    statistics: validation.statistics,
  });

  if (validation.errors.length > 0) {
    console.error('[GeoJSON Diagnosis] ERRORS FOUND:', validation.errors);
  }
  if (validation.warnings.length > 0) {
    console.warn('[GeoJSON Diagnosis] WARNINGS:', validation.warnings);
  }

  return diagnosis;
}

/**
 * Export lateral inspections as GeoJSON and trigger download
 */
export function exportLateralsAsGeoJSON(laterals: LateralInspection[], filename?: string): void {
  console.log('[GeoJSON Export] Starting export process...');
  
  const geojson = lateralsToGeoJSON(laterals);
  const validation = validateGeoJSONExport(geojson);
  
  console.log('[GeoJSON Export] Validation results:', {
    isValid: validation.isValid,
    errorCount: validation.errors.length,
    warningCount: validation.warnings.length,
    statistics: validation.statistics,
  });

  if (validation.errors.length > 0) {
    console.error('[GeoJSON Export] ERRORS FOUND - Export may contain invalid coordinates:', validation.errors);
    // Still allow export but warn the user
    alert(`Warning: ${validation.errors.length} coordinate error(s) found in the GeoJSON. Check the browser console for details.`);
  }

  if (validation.warnings.length > 0) {
    console.warn('[GeoJSON Export] Warnings:', validation.warnings);
  }

  downloadGeoJSON(geojson, filename);
  
  console.log('[GeoJSON Export] Export complete');
}

/**
 * Export tap inspections as GeoJSON and trigger download
 */
export function exportTapsAsGeoJSON(taps: TapInspection[], filename?: string): void {
  const geojson = tapsToGeoJSON(taps);
  downloadGeoJSON(geojson, filename || 'tap-inspections.geojson');
}

