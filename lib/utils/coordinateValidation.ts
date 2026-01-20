/**
 * Validate and fix coordinates to ensure they're in WGS84 format [lng, lat]
 * with latitude between -90 and 90
 * 
 * This function can be used on both server and client side
 */
export function validateCoordinates(coords: [number, number] | null | undefined): [number, number] | null {
  if (!coords || !Array.isArray(coords) || coords.length < 2) {
    console.warn('Invalid coordinates array:', coords);
    return null;
  }
  
  let [first, second] = coords;
  
  // Check for NaN or undefined
  if (typeof first !== 'number' || typeof second !== 'number' || isNaN(first) || isNaN(second)) {
    console.warn('Coordinates contain NaN or invalid numbers:', { first, second });
    return null;
  }
  
  let lng: number;
  let lat: number;
  let needsSwap = false;
  
  const absFirst = Math.abs(first);
  const absSecond = Math.abs(second);
  
  // Check 1: If values are clearly out of range, they're swapped
  if (absSecond > 90 || absFirst > 180) {
    needsSwap = true;
  }
  // Check 2: Aggressive heuristic detection for swapped coordinates
  // If first value is in latitude range (-90 to 90) AND second is in longitude range (-180 to 180)
  // AND first is smaller in magnitude, assume [lat, lng] format and swap
  else if (absFirst <= 90 && absSecond <= 180) {
    // Pattern 1: First is clearly latitude (|first| <= 90) AND second is clearly longitude (|second| > 90)
    if (absFirst <= 90 && absSecond > 90) {
      needsSwap = true;
    }
    // Pattern 2: Both in valid ranges, but first looks like latitude and second looks like longitude
    // AGGRESSIVE: If |first| < |second| and first is in lat range, assume [lat, lng] and swap
    // This catches cases like [37.678912, -121.845331] where 37 < 121
    else if (absFirst <= 90 && absSecond <= 180 && absFirst < absSecond) {
      // Swap if:
      // - First is positive and second is negative (common US pattern)
      // - OR first is significantly smaller (latitude typically < 60, longitude often > 60)
      // - OR the magnitude difference is significant
      const shouldSwap = 
        (first > 0 && second < 0) || // Common US: positive lat, negative lng
        (absFirst < 60 && absSecond > 60) || // Latitude < 60, longitude > 60
        (absFirst < absSecond * 0.8) || // First is significantly smaller (80% threshold)
        (absFirst < 50); // If first is < 50, it's almost certainly latitude
      
      if (shouldSwap) {
        needsSwap = true;
      }
    }
    // Pattern 3: If first is in latitude range and second is in longitude range
    // and first is positive and second is negative, it's likely [lat, lng] for US coordinates
    else if (absFirst <= 90 && absSecond <= 180 && first > 0 && second < 0) {
      needsSwap = true;
    }
  }
  
  // Apply swap if needed
  if (needsSwap) {
    [lng, lat] = [second, first];
    console.log(`Swapped coordinates from [${first}, ${second}] to [${lng}, ${lat}]`);
  } else {
    [lng, lat] = [first, second];
  }
  
  // Final safety check: If latitude is still out of range after swap detection,
  // try swapping one more time as a last resort
  if (lat < -90 || lat > 90) {
    // If latitude is invalid, try swapping (maybe the swap detection missed it)
    if (lng >= -90 && lng <= 90 && (lat < -180 || lat > 180 || Math.abs(lat) > Math.abs(lng))) {
      console.warn(`Final safety swap: latitude ${lat} out of range, swapping coordinates`);
      [lng, lat] = [lat, lng];
    } else {
      // Can't swap, so clamp it
      console.warn(`Invalid latitude ${lat}, clamping to valid range`);
      lat = Math.max(-90, Math.min(90, lat));
    }
  }
  
  // Validate latitude is within valid range (final check)
  if (lat < -90 || lat > 90) {
    console.warn(`Invalid latitude ${lat} after all checks, clamping to valid range`);
    lat = Math.max(-90, Math.min(90, lat));
  }
  
  // Validate longitude is within valid range (wrap if needed)
  if (lng < -180 || lng > 180) {
    console.warn(`Invalid longitude ${lng}, wrapping to valid range`);
    lng = ((lng + 180) % 360) - 180;
  }
  
  // Final validation: ensure we never return invalid coordinates
  if (lat < -90 || lat > 90 || isNaN(lat) || isNaN(lng)) {
    console.error(`CRITICAL: Invalid coordinates after all validation: [${lng}, ${lat}]`);
    return null;
  }
  
  return [lng, lat];
}

