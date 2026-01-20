import { GeocodingResult } from '../types';

const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

// Cache to minimize API calls
const geocodingCache = new Map<string, GeocodingResult>();

/**
 * Reverse geocode coordinates to get address using Mapbox
 */
export async function reverseGeocode(
  lng: number,
  lat: number
): Promise<GeocodingResult> {
  const cacheKey = `${lng.toFixed(6)},${lat.toFixed(6)}`;
  
  // Check cache first
  if (geocodingCache.has(cacheKey)) {
    return geocodingCache.get(cacheKey)!;
  }

  if (!MAPBOX_ACCESS_TOKEN) {
    throw new Error('Mapbox access token is not configured');
  }

  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_ACCESS_TOKEN}&types=address`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    let address = 'Address not found';
    const details: GeocodingResult['details'] = {};

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      const context = feature.context || [];
      
      // Extract address components
      const street = feature.properties?.address || feature.text || '';
      const city = context.find((c: any) => c.id.startsWith('place'))?.text || '';
      const state = context.find((c: any) => c.id.startsWith('region'))?.text || '';
      const zip = context.find((c: any) => c.id.startsWith('postcode'))?.text || '';
      
      details.street = street;
      details.city = city;
      details.state = state;
      details.zip = zip;
      
      // Build full address
      const addressParts = [street, city, state, zip].filter(Boolean);
      address = addressParts.join(', ') || feature.place_name || 'Address not found';
      details.fullAddress = address;
    }

    const result: GeocodingResult = {
      address,
      details,
    };

    // Cache the result
    geocodingCache.set(cacheKey, result);
    
    return result;
  } catch (error) {
    console.error('Geocoding error:', error);
    return {
      address: 'Geocoding failed',
      details: {},
    };
  }
}

/**
 * Batch reverse geocode multiple coordinates
 */
export async function batchReverseGeocode(
  coordinates: Array<[number, number]>
): Promise<GeocodingResult[]> {
  const results = await Promise.all(
    coordinates.map(([lng, lat]) => reverseGeocode(lng, lat))
  );
  return results;
}

/**
 * Clear the geocoding cache
 */
export function clearGeocodingCache(): void {
  geocodingCache.clear();
}

