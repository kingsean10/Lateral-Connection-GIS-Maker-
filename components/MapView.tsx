'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Map, { Marker, Source, Layer, MapRef } from 'react-map-gl';
// Use global Map for data structures to avoid conflict with react-map-gl's Map component
const DataMap = globalThis.Map;
import 'mapbox-gl/dist/mapbox-gl.css';
import { FeatureCollection, Point } from 'geojson';
import { SewerAsset, LateralInspection, DefectRecord, InspectionRecord, TapInspection } from '@/lib/types';
import { matchInspectionsToAssets } from '@/lib/parsers/mdbParser';
import { calculateLateralPosition } from '@/lib/utils/lateralCalculator';
import { reverseGeocode } from '@/lib/services/geocodingService';

interface MapViewProps {
  assets?: SewerAsset[];
  inspections?: InspectionRecord[];
  laterals?: LateralInspection[];
  defects?: DefectRecord[];
  taps?: TapInspection[];
  onLateralClick?: (lateral: LateralInspection) => void;
  onDefectClick?: (defect: DefectRecord) => void;
  onInspectionClick?: (inspection: InspectionRecord) => void;
  onTapsChange?: (taps: TapInspection[]) => void;
}

export default function MapView({
  assets = [],
  inspections = [],
  laterals = [],
  defects = [],
  taps: externalTaps,
  onLateralClick,
  onDefectClick,
  onInspectionClick,
  onTapsChange,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const [selectedLateral, setSelectedLateral] = useState<LateralInspection | null>(null);
  const [selectedDefect, setSelectedDefect] = useState<DefectRecord | null>(null);
  const [selectedInspection, setSelectedInspection] = useState<InspectionRecord | null>(null);
  const [selectedTap, setSelectedTap] = useState<TapInspection | null>(null);
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
  
  // Match inspections to assets and create inspection points
  const inspectionPoints = useMemo(() => {
    const points: Array<{ inspection: InspectionRecord; coordinates: [number, number] }> = [];
    
    if (inspections.length === 0 || assets.length === 0) {
      return points;
    }
    
    try {
      const matchedInspections = matchInspectionsToAssets(inspections, assets);
      
      for (const asset of assets) {
        const fid = asset.properties?.FID || asset.properties?.fid || asset.properties?.Fid;
        const assetKey = fid ? String(fid).trim() : 
                         (asset.properties?.id || asset.properties?.assetId || asset.properties?.ASSET_ID ||
                          `asset-${assets.indexOf(asset)}`);
        const assetKeyStr = String(assetKey).trim();
        
        const assetInspections = matchedInspections.get(assetKeyStr) || [];
        
        for (const inspection of assetInspections) {
          // Get coordinates from asset geometry
          let coordinates: [number, number] | null = null;
          
          const geometry = asset.geometry;
          
          if (geometry.type === 'Point') {
            coordinates = geometry.coordinates as [number, number];
          } else if (geometry.type === 'LineString') {
            // Use the first point of the line
            const coords = geometry.coordinates as [number, number][];
            if (coords.length > 0) {
              coordinates = coords[0];
            }
          } else if (geometry.type === 'MultiLineString') {
            // Use the first point of the first line
            const coords = geometry.coordinates as [number, number][][];
            if (coords.length > 0 && coords[0].length > 0) {
              coordinates = coords[0][0];
            }
          }
          
          if (coordinates) {
            points.push({ inspection, coordinates });
          }
        }
      }
    } catch (error) {
      console.error('Error matching inspections to assets:', error);
    }
    
    return points;
  }, [inspections, assets]);
  
  // Helper function to detect tap codes (TB, TF, TS)
  const isTapCode = (code: string | null | undefined): boolean => {
    const c = (code ?? "").trim().toUpperCase();
    return c.startsWith("TB") || c.startsWith("TF") || c.startsWith("TS");
  };

  // Calculate tap positions from defects with tap codes (TB/TF/TS)
  const tapPoints = useMemo(() => {
    const taps: Array<{ defect: DefectRecord; coordinates: [number, number] }> = [];
    
    if (defects.length === 0 || assets.length === 0 || inspections.length === 0) {
      console.log('Tap calculation: Missing data', { 
        defectsCount: defects.length, 
        assetsCount: assets.length,
        inspectionsCount: inspections.length 
      });
      return taps;
    }
    
    try {
      // Step 1: Filter defects to find taps (PACP_Code starts with TB/TF/TS and has distance)
      const tapDefects = defects.filter(d => {
        const code = d.defectCode ?? d.properties?.PACP_Code ?? d.properties?.Code;
        const hasTapCode = isTapCode(code);
        const hasDistance = d.distance != null && !Number.isNaN(Number(d.distance));
        return hasTapCode && hasDistance;
      });
      
      console.log("Tap defects:", tapDefects.length, "of", defects.length);
      if (tapDefects.length > 0) {
        console.log("Tap sample:", tapDefects[0]);
      }
      
      // Step 2: Join defects to inspections by inspectionId
      const inspById = new DataMap<string, InspectionRecord>();
      inspections.forEach(i => {
        if (i.inspectionId) {
          inspById.set(String(i.inspectionId).trim(), i);
        }
      });
      
      const tapsWithInspection = tapDefects.filter(t => {
        if (!t.inspectionId) return false;
        return inspById.has(String(t.inspectionId).trim());
      });
      
      console.log("Taps joined to inspections:", tapsWithInspection.length, "of", tapDefects.length);
      
      // Step 3: Join inspections to GeoJSON assets by FID (pipeSegmentReference)
      const fidSet = new Set<string>();
      assets.forEach(asset => {
        const fid = asset.properties?.FID || asset.properties?.fid || asset.properties?.Fid;
        if (fid) {
          fidSet.add(String(fid).trim());
        }
      });
      
      const tapsWithPipe = tapsWithInspection.filter(t => {
        const insp = inspById.get(String(t.inspectionId).trim());
        if (!insp) return false;
        const fid = String(insp.pipeSegmentReference ?? "").trim();
        return fidSet.has(fid);
      });
      
      console.log("Taps joined to pipes (GeoJSON):", tapsWithPipe.length, "of", tapsWithInspection.length);
      
      // Step 4: Calculate tap positions for matched taps
      for (const tapDefect of tapsWithPipe) {
        const inspection = inspById.get(String(tapDefect.inspectionId).trim());
        if (!inspection) continue;
        
        const fid = String(inspection.pipeSegmentReference ?? "").trim();
        
        // Find the matching asset
        const asset = assets.find(a => {
          const assetFid = a.properties?.FID || a.properties?.fid || a.properties?.Fid;
          return assetFid && String(assetFid).trim() === fid;
        });
        
        if (!asset) continue;
        
        // Get distance and handle unit conversion
        let distanceMeters = Number(tapDefect.distance);
        
        // Check if inspection uses imperial units (feet)
        const isImperial = inspection.isImperial ?? inspection.raw?.IsImperial ?? inspection.properties?.IsImperial;
        if (isImperial === 1 || isImperial === true) {
          // Convert feet to meters
          distanceMeters = distanceMeters * 0.3048;
        }
        
        // Use clock position if available, otherwise default to 12 (north/top)
        const clockPosition = tapDefect.clockPosition ?? 12;
        
        try {
          const tapCoordinates = calculateLateralPosition(
            asset,
            distanceMeters,
            clockPosition
          ) as [number, number];
          
          taps.push({ defect: tapDefect, coordinates: tapCoordinates });
        } catch (error) {
          console.warn(`Error calculating tap position for defect ${tapDefect.id}:`, error);
        }
      }
      
      console.log('Tap calculation complete:', { tapsCount: taps.length });
    } catch (error) {
      console.error('Error calculating tap positions:', error);
    }
    
    return taps;
  }, [defects, assets, inspections]);
  
  // Geocode tap addresses when tapPoints change
  const [tapInspections, setTapInspections] = useState<TapInspection[]>([]);
  const [isGeocodingTaps, setIsGeocodingTaps] = useState(false);
  const previousTapPointsRef = useRef<string>('');
  
  useEffect(() => {
    if (tapPoints.length === 0) {
      setTapInspections([]);
      if (onTapsChange) {
        onTapsChange([]);
      }
      return;
    }
    
    // Create a stable key from tapPoints to detect actual changes
    const tapPointsKey = tapPoints.map(t => `${t.defect.id}-${t.coordinates[0]}-${t.coordinates[1]}`).join('|');
    
    // Skip if tapPoints haven't actually changed
    if (previousTapPointsRef.current === tapPointsKey) {
      return;
    }
    
    previousTapPointsRef.current = tapPointsKey;
    
    const geocodeTaps = async () => {
      setIsGeocodingTaps(true);
      const tapsWithAddresses: TapInspection[] = [];
      
      for (const { defect, coordinates } of tapPoints) {
        const inspection = inspections.find(i => i.inspectionId === defect.inspectionId);
        const asset = assets.find(a => {
          const assetFid = a.properties?.FID || a.properties?.fid || a.properties?.Fid;
          const fid = inspection?.pipeSegmentReference ? String(inspection.pipeSegmentReference).trim() : '';
          return assetFid && String(assetFid).trim() === fid;
        });
        
        let address = 'Address not found';
        let addressDetails = {};
        
        try {
          const geocodingResult = await Promise.race([
            reverseGeocode(coordinates[0], coordinates[1]),
            new Promise<{ address: string; details: any }>((_, reject) =>
              setTimeout(() => reject(new Error('Geocoding timeout')), 5000)
            )
          ]);
          address = geocodingResult.address;
          addressDetails = geocodingResult.details;
        } catch (geocodeError) {
          console.warn('Geocoding failed for tap:', geocodeError);
        }
        
        const tapInspection: TapInspection = {
          id: `tap-${defect.id}`,
          coordinates,
          assetId: asset ? (asset.properties?.FID || asset.properties?.fid || asset.properties?.Fid || '') : '',
          pipeSegmentReference: inspection?.pipeSegmentReference,
          inspectionId: defect.inspectionId,
          defectCode: defect.defectCode,
          distance: defect.distance ?? 0,
          clockPosition: defect.clockPosition ?? 12,
          address,
          addressDetails,
          inspectionDate: inspection?.inspectionDate,
          properties: {
            ...defect.properties,
            inspectionId: defect.inspectionId,
            pipeSegmentReference: inspection?.pipeSegmentReference,
          },
        };
        
        tapsWithAddresses.push(tapInspection);
      }
      
      setTapInspections(tapsWithAddresses);
      setIsGeocodingTaps(false);
      
      // Notify parent component of taps (only when taps actually change)
      if (onTapsChange) {
        onTapsChange(tapsWithAddresses);
      }
    };
    
    geocodeTaps();
  }, [tapPoints, inspections, assets]); // Removed onTapsChange from dependencies
  
  // Use external taps if provided, otherwise use internal state
  const displayTaps = externalTaps || tapInspections;

  // Calculate bounds to fit all features
  useEffect(() => {
    if (mapRef.current && (assets.length > 0 || laterals.length > 0 || defects.length > 0 || inspections.length > 0 || tapPoints.length > 0)) {
      const allCoordinates: [number, number][] = [];

      // Collect asset coordinates
      assets.forEach((asset) => {
        if (asset.geometry.type === 'Point') {
          allCoordinates.push(asset.geometry.coordinates as [number, number]);
        } else if (asset.geometry.type === 'LineString') {
          allCoordinates.push(...(asset.geometry.coordinates as [number, number][]));
        }
      });

      // Collect lateral coordinates
      laterals.forEach((lateral) => {
        allCoordinates.push(lateral.coordinates);
      });
      
      // Collect defect coordinates
      defects.forEach((defect) => {
        if (defect.coordinates) {
          allCoordinates.push(defect.coordinates);
        }
      });
      
      // Collect defect coordinates
      defects.forEach((defect) => {
        if (defect.coordinates) {
          allCoordinates.push(defect.coordinates);
        }
      });

      if (allCoordinates.length > 0) {
        const bounds = allCoordinates.reduce(
          (acc, coord) => {
            return {
              minLng: Math.min(acc.minLng, coord[0]),
              maxLng: Math.max(acc.maxLng, coord[0]),
              minLat: Math.min(acc.minLat, coord[1]),
              maxLat: Math.max(acc.maxLat, coord[1]),
            };
          },
          {
            minLng: allCoordinates[0][0],
            maxLng: allCoordinates[0][0],
            minLat: allCoordinates[0][1],
            maxLat: allCoordinates[0][1],
          }
        );

        mapRef.current.fitBounds(
          [
            [bounds.minLng, bounds.minLat],
            [bounds.maxLng, bounds.maxLat],
          ],
          {
            padding: 50,
            duration: 1000,
          }
        );
      }
    }
  }, [assets, laterals, defects, inspections, tapPoints]);

  const handleLateralClick = useCallback(
    (lateral: LateralInspection) => {
      setSelectedLateral(lateral);
      setSelectedDefect(null);
      setSelectedInspection(null);
      if (onLateralClick) {
        onLateralClick(lateral);
      }
    },
    [onLateralClick]
  );
  
  const handleDefectClick = useCallback(
    (defect: DefectRecord) => {
      setSelectedDefect(defect);
      setSelectedLateral(null);
      setSelectedInspection(null);
      if (onDefectClick) {
        onDefectClick(defect);
      }
    },
    [onDefectClick]
  );
  
  const handleInspectionClick = useCallback(
    (inspection: InspectionRecord) => {
      setSelectedInspection(inspection);
      setSelectedLateral(null);
      setSelectedDefect(null);
      if (onInspectionClick) {
        onInspectionClick(inspection);
      }
    },
    [onInspectionClick]
  );

  // Convert assets to GeoJSON for display
  const assetsGeoJSON: FeatureCollection = {
    type: 'FeatureCollection',
    features: assets,
  };

  // Convert laterals to GeoJSON for display
  const lateralsGeoJSON: FeatureCollection<Point> = {
    type: 'FeatureCollection',
    features: laterals.map((lateral) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: lateral.coordinates,
      },
      properties: {
        id: lateral.id,
        address: lateral.address,
        type: 'lateral',
      },
    })),
  };
  
  // Convert defects to GeoJSON for display
  const defectsGeoJSON: FeatureCollection<Point> = {
    type: 'FeatureCollection',
    features: defects
      .filter(defect => defect.coordinates) // Only defects with coordinates
      .map((defect) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: defect.coordinates!,
        },
        properties: {
          id: defect.id,
          defectCode: defect.defectCode,
          defectDescription: defect.defectDescription,
          grade: defect.grade,
          type: 'defect',
        },
      })),
  };
  
  // Convert inspections to GeoJSON for display
  const inspectionsGeoJSON: FeatureCollection<Point> = {
    type: 'FeatureCollection',
    features: inspectionPoints.map(({ inspection, coordinates }) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates,
      },
      properties: {
        id: inspection.inspectionId || `inspection-${inspection.pipeSegmentReference}`,
        inspectionId: inspection.inspectionId,
        pipeSegmentReference: inspection.pipeSegmentReference,
        type: 'inspection',
      },
    })),
  };
  
  // Convert taps to GeoJSON for display (use displayTaps which have addresses)
  const tapsGeoJSON: FeatureCollection<Point> = {
    type: 'FeatureCollection',
    features: displayTaps.map((tap) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: tap.coordinates,
      },
      properties: {
        id: tap.id,
        defectCode: tap.defectCode,
        distance: tap.distance,
        clockPosition: tap.clockPosition,
        address: tap.address,
        type: 'tap',
      },
    })),
  };

  if (!mapboxToken) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded-lg">
        <div className="text-center p-4">
          <p className="text-gray-600 mb-2">
            Mapbox token not configured.
          </p>
          <p className="text-sm text-gray-500">
            Please set NEXT_PUBLIC_MAPBOX_TOKEN in your environment variables.
          </p>
        </div>
      </div>
    );
  }

  // Show message when no data is available
  if (assets.length === 0 && laterals.length === 0 && defects.length === 0 && inspections.length === 0 && tapPoints.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded-lg">
        <div className="text-center p-4">
          <p className="text-gray-600 mb-2">
            No data to display
          </p>
          <p className="text-sm text-gray-500">
            Upload GeoJSON assets and process inspection data to see results on the map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative rounded-lg overflow-hidden">
      <Map
        ref={mapRef}
        mapboxAccessToken={mapboxToken}
        initialViewState={{
          longitude: -98.5795,
          latitude: 39.8283,
          zoom: 3,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
      >
        {/* Assets layer */}
        {assets.length > 0 && (
          <>
            <Source id="assets" type="geojson" data={assetsGeoJSON}>
              <Layer
                id="assets-points"
                type="circle"
                filter={['==', ['geometry-type'], 'Point']}
                paint={{
                  'circle-radius': 6,
                  'circle-color': '#3b82f6',
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#ffffff',
                }}
              />
              <Layer
                id="assets-lines"
                type="line"
                filter={['==', ['geometry-type'], 'LineString']}
                paint={{
                  'line-color': '#3b82f6',
                  'line-width': 3,
                }}
              />
            </Source>
          </>
        )}

        {/* Laterals layer */}
        {laterals.length > 0 && (
          <>
            <Source id="laterals" type="geojson" data={lateralsGeoJSON}>
              <Layer
                id="laterals-points"
                type="circle"
                paint={{
                  'circle-radius': 8,
                  'circle-color': '#ef4444',
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#ffffff',
                }}
              />
            </Source>

            {/* Lateral markers with click handlers */}
            {laterals.map((lateral) => (
              <Marker
                key={lateral.id}
                longitude={lateral.coordinates[0]}
                latitude={lateral.coordinates[1]}
                anchor="center"
                onClick={() => handleLateralClick(lateral)}
                style={{ cursor: 'pointer' }}
              >
                <div
                  className={`w-4 h-4 rounded-full border-2 border-white ${
                    selectedLateral?.id === lateral.id
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                  }`}
                />
              </Marker>
            ))}
          </>
        )}
        
        {/* Inspections layer */}
        {inspections.length > 0 && inspectionsGeoJSON.features.length > 0 && (
          <>
            <Source id="inspections" type="geojson" data={inspectionsGeoJSON}>
              <Layer
                id="inspections-points"
                type="circle"
                paint={{
                  'circle-radius': 7,
                  'circle-color': '#10b981', // Green color for inspections
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#ffffff',
                }}
              />
            </Source>
            
            {/* Inspection markers with click handlers */}
            {inspectionPoints.map(({ inspection, coordinates }) => (
              <Marker
                key={inspection.inspectionId || `inspection-${inspection.pipeSegmentReference}`}
                longitude={coordinates[0]}
                latitude={coordinates[1]}
                anchor="center"
                onClick={() => handleInspectionClick(inspection)}
                style={{ cursor: 'pointer' }}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full border-2 border-white ${
                    selectedInspection?.inspectionId === inspection.inspectionId
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                />
              </Marker>
            ))}
          </>
        )}
        
        {/* Taps layer - defects with distance and clock position */}
        {displayTaps.length > 0 && (
          <>
            <Source id="taps" type="geojson" data={tapsGeoJSON}>
              <Layer
                id="taps-points"
                type="circle"
                paint={{
                  'circle-radius': 8,
                  'circle-color': '#8b5cf6', // Purple color for taps
                  'circle-stroke-width': 2,
                  'circle-stroke-color': '#ffffff',
                }}
              />
            </Source>
            
            {/* Tap markers with click handlers */}
            {displayTaps.map((tap) => (
              <Marker
                key={tap.id}
                longitude={tap.coordinates[0]}
                latitude={tap.coordinates[1]}
                anchor="center"
                onClick={() => setSelectedTap(tap)}
                style={{ cursor: 'pointer' }}
              >
                <div
                  className={`w-4 h-4 rounded-full border-2 border-white ${
                    selectedTap?.id === tap.id
                      ? 'bg-yellow-500'
                      : 'bg-purple-500'
                  }`}
                />
              </Marker>
            ))}
          </>
        )}
        
        {/* Defects layer - exclude defects that are already shown as taps */}
        {defects.length > 0 && defectsGeoJSON.features.length > 0 && (() => {
          // Get set of tap defect IDs to exclude from defects layer
          const tapDefectIds = new Set(displayTaps.map(tap => {
            // Extract original defect ID from tap ID (tap-{defectId})
            const match = tap.id.match(/^tap-(.+)$/);
            return match ? match[1] : null;
          }).filter(Boolean));
          
          const nonTapDefects = defects.filter(defect => 
            defect.coordinates && !tapDefectIds.has(defect.id)
          );
          
          if (nonTapDefects.length === 0) return null;
          
          return (
            <>
              <Source id="defects" type="geojson" data={defectsGeoJSON}>
                <Layer
                  id="defects-points"
                  type="circle"
                  paint={{
                    'circle-radius': 6,
                    'circle-color': '#f59e0b', // Orange/amber color for defects
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                  }}
                />
              </Source>

              {/* Defect markers with click handlers */}
              {nonTapDefects.map((defect) => (
                <Marker
                  key={`defect-${defect.id}`}
                  longitude={defect.coordinates![0]}
                  latitude={defect.coordinates![1]}
                  anchor="center"
                  onClick={() => handleDefectClick(defect)}
                  style={{ cursor: 'pointer' }}
                >
                  <div
                    className={`w-3 h-3 rounded-full border-2 border-white ${
                      selectedDefect?.id === defect.id
                        ? 'bg-yellow-500'
                        : 'bg-orange-500'
                    }`}
                  />
                </Marker>
              ))}
            </>
          );
        })()}
      </Map>

      {/* Info popup for lateral */}
      {selectedLateral && (
        <div className="absolute top-4 right-4 bg-white p-4 rounded-lg shadow-lg max-w-sm z-10">
          <button
            onClick={() => setSelectedLateral(null)}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
          <h3 className="font-semibold mb-2">Lateral Inspection</h3>
          <div className="text-sm space-y-1">
            <p>
              <span className="font-medium">Address:</span>{' '}
              {selectedLateral.address || 'Not found'}
            </p>
            <p>
              <span className="font-medium">Tap Distance:</span>{' '}
              {selectedLateral.tapDistance.toFixed(2)}m
            </p>
            <p>
              <span className="font-medium">Clock Position:</span>{' '}
              {selectedLateral.clockPosition}
            </p>
            {selectedLateral.assetId && (
              <p>
                <span className="font-medium">Asset ID (FID):</span>{' '}
                {selectedLateral.assetId}
              </p>
            )}
            {selectedLateral.properties?.pipeSegmentReference && (
              <p>
                <span className="font-medium">Pipe Segment Reference:</span>{' '}
                {selectedLateral.properties.pipeSegmentReference}
              </p>
            )}
            {selectedLateral.properties?.defectCount !== undefined && (
              <p>
                <span className="font-medium">Defects:</span>{' '}
                {selectedLateral.properties.defectCount}
              </p>
            )}
            {selectedLateral.inspectionDate && (
              <p>
                <span className="font-medium">Inspection Date:</span>{' '}
                {selectedLateral.inspectionDate}
              </p>
            )}
          </div>
        </div>
      )}
      
      {/* Info popup for inspection */}
      {selectedInspection && (
        <div className="absolute top-4 right-4 bg-white p-4 rounded-lg shadow-lg max-w-sm z-10">
          <button
            onClick={() => setSelectedInspection(null)}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
          <h3 className="font-semibold mb-2 text-green-600">Inspection</h3>
          <div className="text-sm space-y-1">
            {selectedInspection.inspectionId && (
              <p>
                <span className="font-medium">Inspection ID:</span>{' '}
                {selectedInspection.inspectionId}
              </p>
            )}
            {selectedInspection.pipeSegmentReference && (
              <p>
                <span className="font-medium">Pipe Segment Reference:</span>{' '}
                {selectedInspection.pipeSegmentReference}
              </p>
            )}
            {selectedInspection.inspectionDate && (
              <p>
                <span className="font-medium">Inspection Date:</span>{' '}
                {selectedInspection.inspectionDate}
              </p>
            )}
            {selectedInspection.direction && (
              <p>
                <span className="font-medium">Direction:</span>{' '}
                {selectedInspection.direction}
              </p>
            )}
            {selectedInspection.lengthSurveyed !== undefined && selectedInspection.lengthSurveyed !== null && (
              <p>
                <span className="font-medium">Length Surveyed:</span>{' '}
                {selectedInspection.lengthSurveyed}
              </p>
            )}
            {selectedInspection.upstreamMH && (
              <p>
                <span className="font-medium">Upstream MH:</span>{' '}
                {selectedInspection.upstreamMH}
              </p>
            )}
            {selectedInspection.downstreamMH && (
              <p>
                <span className="font-medium">Downstream MH:</span>{' '}
                {selectedInspection.downstreamMH}
              </p>
            )}
          </div>
        </div>
      )}
      
      {/* Info popup for tap */}
      {selectedTap && (
        <div className="absolute top-4 right-4 bg-white p-4 rounded-lg shadow-lg max-w-sm z-10">
          <button
            onClick={() => setSelectedTap(null)}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
          <h3 className="font-semibold mb-2 text-purple-600">Tap Inspection</h3>
          <div className="text-sm space-y-1">
            {selectedTap.address && (
              <p>
                <span className="font-medium">Address:</span>{' '}
                {selectedTap.address}
              </p>
            )}
            {selectedTap.defectCode && (
              <p>
                <span className="font-medium">Defect Code:</span>{' '}
                {selectedTap.defectCode}
              </p>
            )}
            {selectedTap.distance !== undefined && (
              <p>
                <span className="font-medium">Distance:</span>{' '}
                {selectedTap.distance.toFixed(2)}m
              </p>
            )}
            {selectedTap.clockPosition !== undefined && (
              <p>
                <span className="font-medium">Clock Position:</span>{' '}
                {selectedTap.clockPosition}
              </p>
            )}
            {selectedTap.pipeSegmentReference && (
              <p>
                <span className="font-medium">Pipe Segment Reference:</span>{' '}
                {selectedTap.pipeSegmentReference}
              </p>
            )}
            {selectedTap.inspectionId && (
              <p>
                <span className="font-medium">Inspection ID:</span>{' '}
                {selectedTap.inspectionId}
              </p>
            )}
            {selectedTap.inspectionDate && (
              <p>
                <span className="font-medium">Inspection Date:</span>{' '}
                {selectedTap.inspectionDate}
              </p>
            )}
          </div>
        </div>
      )}
      
      {/* Info popup for defect */}
      {selectedDefect && !selectedTap && (
        <div className="absolute top-4 right-4 bg-white p-4 rounded-lg shadow-lg max-w-sm z-10">
          <button
            onClick={() => setSelectedDefect(null)}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
          <h3 className="font-semibold mb-2">Defect</h3>
          <div className="text-sm space-y-1">
            {selectedDefect.defectCode && (
              <p>
                <span className="font-medium">Defect Code:</span>{' '}
                {selectedDefect.defectCode}
              </p>
            )}
            {selectedDefect.defectDescription && (
              <p>
                <span className="font-medium">Description:</span>{' '}
                {selectedDefect.defectDescription}
              </p>
            )}
            {selectedDefect.grade !== undefined && (
              <p>
                <span className="font-medium">Grade:</span>{' '}
                {String(selectedDefect.grade)}
              </p>
            )}
            {selectedDefect.distance !== undefined && (
              <p>
                <span className="font-medium">Distance:</span>{' '}
                {selectedDefect.distance.toFixed(2)}m
              </p>
            )}
            {selectedDefect.clockPosition !== undefined && (
              <p>
                <span className="font-medium">Clock Position:</span>{' '}
                {selectedDefect.clockPosition}
              </p>
            )}
            {selectedDefect.pipeSegmentReference && (
              <p>
                <span className="font-medium">Pipe Segment Reference:</span>{' '}
                {selectedDefect.pipeSegmentReference}
              </p>
            )}
            {selectedDefect.inspectionId && (
              <p>
                <span className="font-medium">Inspection ID:</span>{' '}
                {selectedDefect.inspectionId}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

