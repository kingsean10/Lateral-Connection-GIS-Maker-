import { Point, LineString, Position, MultiLineString } from 'geojson';
// @ts-ignore - turf types issue with package.json exports
import * as turf from '@turf/turf';
import { SewerAsset } from '../types';

/**
 * Convert clock position (0-12, where 12 is north) to bearing in degrees
 * @param clockPosition Clock position (0-12)
 * @returns Bearing in degrees (0-360, where 0 is north)
 */
export function clockToBearing(clockPosition: number): number {
  // Clock position: 12 = north (0°), 3 = east (90°), 6 = south (180°), 9 = west (270°)
  // Each hour on a clock represents 30° (360° / 12 = 30°)
  // Formula: bearing = (clockPosition % 12) * 30
  // This handles 12 -> 0° correctly since 12 % 12 = 0
  
  let bearing = (clockPosition % 12) * 30;
  
  // Normalize to 0-360 (should already be in range, but ensure it)
  while (bearing < 0) bearing += 360;
  while (bearing >= 360) bearing -= 360;
  
  return bearing;
}

/**
 * Interpret only the horizontal component of the clock position (left/right)
 * @param clock Clock position (0-12, or null)
 * @returns Object with side (-1 for left, +1 for right, 0 for center) and confidence level
 */
export function clockToSide(clock: number | null | undefined): { side: number; confidence: 'high' | 'low' | 'none' } {
  if (clock == null) return { side: 0, confidence: 'none' };
  
  // Normalize to 0–12
  const c = ((clock % 12) + 12) % 12 || 12;

  // Only trust left/right strongly
  if (c === 3) return { side: +1, confidence: 'high' }; // right
  if (c === 9) return { side: -1, confidence: 'high' }; // left

  // For all others, still allow a softer inference
  if (c > 0 && c < 6) return { side: +1, confidence: 'low' }; // right-ish
  if (c > 6 && c < 12) return { side: -1, confidence: 'low' }; // left-ish

  // 12 or 6 (top or bottom)
  return { side: 0, confidence: 'low' };
}

/**
 * Calculate lateral position from a point asset
 */
export function calculateLateralFromPoint(
  point: Point,
  tapDistance: number,
  clockPosition: number
): Position {
  const [lng, lat] = point.coordinates;
  const bearing = clockToBearing(clockPosition);
  
  // Use Turf.js to calculate destination point
  const destination = turf.destination(
    [lng, lat],
    tapDistance, // distance in meters
    bearing, // bearing in degrees
    { units: 'meters' }
  );
  
  return destination.geometry.coordinates;
}

/**
 * Calculate lateral position from a line asset
 * For line assets, we place the tap at the specified distance along the line,
 * then offset perpendicular to the line (left/right only) based on clock position
 */
export function calculateLateralFromLine(
  line: LineString,
  tapDistance: number,
  clockPosition: number,
  useMidpoint: boolean = false
): Position {
  // Convert distance to kilometers for turf.along (turf expects km)
  const distanceKm = tapDistance / 1000;
  
  // Create a turf lineString from the coordinates
  const lineString = turf.lineString(line.coordinates);
  
  // Get the total length of the line
  const lineLength = turf.length(lineString, { units: 'kilometers' });
  
  // Clamp distance to line length
  const clampedDistance = Math.min(distanceKm, lineLength);
  
  // Get the point along the line at the specified distance
  const pointAlong = turf.along(lineString, clampedDistance, { units: 'kilometers' });
  let referencePoint = pointAlong.geometry.coordinates;
  
  // If clock position is provided, calculate offset perpendicular to the line (left/right only)
  if (clockPosition !== undefined && clockPosition !== null) {
    // Get the horizontal component (left/right) from clock position
    const { side } = clockToSide(clockPosition);
    
    // Only offset if we have a clear left/right indication
    if (side !== 0) {
      // Calculate the bearing of the line at this point
      // Get a small segment around the point to calculate bearing
      const segmentStart = Math.max(0, clampedDistance - 0.001); // 1 meter before
      const segmentEnd = Math.min(lineLength, clampedDistance + 0.001); // 1 meter after
      
      const pointBefore = turf.along(lineString, segmentStart, { units: 'kilometers' });
      const pointAfter = turf.along(lineString, segmentEnd, { units: 'kilometers' });
      
      // Calculate bearing of the line segment
      const lineBearing = turf.bearing(
        pointBefore.geometry.coordinates,
        pointAfter.geometry.coordinates
      );
      
      // Offset perpendicular to the line:
      // side = +1 (right): 90° to the right of line direction
      // side = -1 (left): 90° to the left of line direction
      const perpendicularBearing = lineBearing + (side * 90);
      
      // Normalize bearing to 0-360
      let normalizedBearing = perpendicularBearing;
      while (normalizedBearing < 0) normalizedBearing += 360;
      while (normalizedBearing >= 360) normalizedBearing -= 360;
      
      // Offset distance: use a reasonable default (e.g., 2 meters) or could be configurable
      const offsetDistance = 2; // 2 meters offset from line
      
      const destination = turf.destination(
        referencePoint,
        offsetDistance,
        normalizedBearing,
        { units: 'meters' }
      );
      referencePoint = destination.geometry.coordinates;
    }
    // If side === 0, we don't offset (tap stays on the line)
  }
  
  return referencePoint;
}

/**
 * Calculate lateral position from a sewer asset
 */
export function calculateLateralPosition(
  asset: SewerAsset,
  tapDistance: number,
  clockPosition: number
): Position {
  const geometry = asset.geometry;
  const geomType = geometry.type;
  
  if (geomType === 'Point') {
    return calculateLateralFromPoint(geometry as Point, tapDistance, clockPosition);
  } else if (geomType === 'LineString') {
    return calculateLateralFromLine(geometry as LineString, tapDistance, clockPosition);
  } else if (geomType === 'MultiLineString') {
    // For MultiLineString, use the first line
    const multiLine = geometry as MultiLineString;
    const firstLine: LineString = {
      type: 'LineString',
      coordinates: multiLine.coordinates[0] as Position[],
    };
    return calculateLateralFromLine(firstLine, tapDistance, clockPosition);
  } else {
    throw new Error(`Unsupported geometry type: ${geomType}`);
  }
}

/**
 * Calculate a lateral stub line (10ft) perpendicular to the mainline
 * For LineString/MultiLineString: stub extends perpendicular from the connection point on the mainline
 * For Point: stub extends in the direction indicated by clock position
 * 
 * @param asset The sewer asset (mainline)
 * @param tapDistance Distance along the mainline where the lateral connects (in meters)
 * @param clockPosition Clock position (0-12) indicating direction
 * @param stubLength Length of the stub in meters (default: 10ft = 3.048m)
 * @returns Object with connectionPoint (on mainline) and stubLine (LineString coordinates)
 */
export function calculateLateralStub(
  asset: SewerAsset,
  tapDistance: number,
  clockPosition: number,
  stubLength: number = 3.048 // 10 feet in meters
): { connectionPoint: Position; stubLine: [Position, Position] } {
  const geometry = asset.geometry;
  const geomType = geometry.type;
  
  if (geomType === 'Point') {
    // For Point assets, use clock position as direct bearing
    const [lng, lat] = (geometry as Point).coordinates;
    const bearing = clockToBearing(clockPosition);
    
    // Connection point is the asset point itself
    const connectionPoint: Position = [lng, lat];
    
    // Create stub end point using bearing
    const stubEnd = turf.destination(
      connectionPoint,
      stubLength,
      bearing,
      { units: 'meters' }
    );
    
    return {
      connectionPoint,
      stubLine: [connectionPoint, stubEnd.geometry.coordinates],
    };
  } else if (geomType === 'LineString') {
    return calculateStubFromLine(geometry as LineString, tapDistance, clockPosition, stubLength);
  } else if (geomType === 'MultiLineString') {
    // For MultiLineString, use the first line
    const multiLine = geometry as MultiLineString;
    const firstLine: LineString = {
      type: 'LineString',
      coordinates: multiLine.coordinates[0] as Position[],
    };
    return calculateStubFromLine(firstLine, tapDistance, clockPosition, stubLength);
  } else {
    throw new Error(`Unsupported geometry type: ${geomType}`);
  }
}

/**
 * Calculate stub line from a LineString asset
 */
function calculateStubFromLine(
  line: LineString,
  tapDistance: number,
  clockPosition: number,
  stubLength: number
): { connectionPoint: Position; stubLine: [Position, Position] } {
  // Convert distance to kilometers for turf.along (turf expects km)
  const distanceKm = tapDistance / 1000;
  
  // Create a turf lineString from the coordinates
  const lineString = turf.lineString(line.coordinates);
  
  // Get the total length of the line
  const lineLength = turf.length(lineString, { units: 'kilometers' });
  
  // Clamp distance to line length
  const clampedDistance = Math.min(distanceKm, lineLength);
  
  // Get the connection point on the mainline at the specified distance
  const pointAlong = turf.along(lineString, clampedDistance, { units: 'kilometers' });
  const connectionPoint: Position = pointAlong.geometry.coordinates;
  
  // Calculate the bearing of the mainline at this point
  // Get a small segment around the point to calculate bearing
  const segmentStart = Math.max(0, clampedDistance - 0.001); // 1 meter before
  const segmentEnd = Math.min(lineLength, clampedDistance + 0.001); // 1 meter after
  
  const pointBefore = turf.along(lineString, segmentStart, { units: 'kilometers' });
  const pointAfter = turf.along(lineString, segmentEnd, { units: 'kilometers' });
  
  // Calculate bearing of the line segment
  const lineBearing = turf.bearing(
    pointBefore.geometry.coordinates,
    pointAfter.geometry.coordinates
  );
  
  // Calculate perpendicular bearing based on clock position
  const { side } = clockToSide(clockPosition);
  
  // Perpendicular bearing: 90° to the left or right of line direction
  // side = +1 (right): 90° to the right
  // side = -1 (left): 90° to the left
  // side = 0: use default (right, or could be configurable)
  const perpendicularBearing = lineBearing + (side !== 0 ? side * 90 : 90);
  
  // Normalize bearing to 0-360
  let normalizedBearing = perpendicularBearing;
  while (normalizedBearing < 0) normalizedBearing += 360;
  while (normalizedBearing >= 360) normalizedBearing -= 360;
  
  // Create stub end point using perpendicular bearing
  const stubEnd = turf.destination(
    connectionPoint,
    stubLength,
    normalizedBearing,
    { units: 'meters' }
  );
  
  return {
    connectionPoint,
    stubLine: [connectionPoint, stubEnd.geometry.coordinates],
  };
}

