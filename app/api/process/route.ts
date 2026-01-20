import { NextRequest, NextResponse } from 'next/server';
import { SewerAsset, InspectionRecord, LateralInspection, DefectRecord, ProcessedData, TapInspection } from '@/lib/types';
import { calculateLateralPosition, calculateLateralStub } from '@/lib/utils/lateralCalculator';
import { reverseGeocode } from '@/lib/services/geocodingService';
import { matchInspectionsToAssets } from '@/lib/parsers/mdbParser';
import { validateCoordinates } from '@/lib/utils/coordinateValidation';

// Increase timeout for processing (Next.js default is 10s, we need more for geocoding)
export const maxDuration = 60; // 60 seconds

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assets, inspections, defects, taps, lateralLayerName } = body as {
      assets: SewerAsset[];
      inspections: InspectionRecord[];
      defects?: DefectRecord[];
      taps?: TapInspection[];
      lateralLayerName?: string;
    };

    if (!assets || !Array.isArray(assets)) {
      return NextResponse.json(
        { error: 'Assets array is required' },
        { status: 400 }
      );
    }

    if (!inspections || !Array.isArray(inspections)) {
      return NextResponse.json(
        { error: 'Inspections array is required' },
        { status: 400 }
      );
    }

    // Match inspections to assets
    const matchedInspections = matchInspectionsToAssets(inspections, assets);
    const laterals: LateralInspection[] = [];
    const processedDefects: DefectRecord[] = [];
    let processedCount = 0;
    let skippedCount = 0;
    let defectCount = 0;

    console.log(`Processing ${assets.length} assets with ${inspections.length} inspections${defects ? ` and ${defects.length} defects` : ''}`);
    
    // Create a map of defects by inspection ID and pipe segment reference
    const defectsByInspectionId = new Map<string, DefectRecord[]>();
    const defectsByPipeSegRef = new Map<string, DefectRecord[]>();
    
    if (defects && defects.length > 0) {
      for (const defect of defects) {
        if (defect.inspectionId) {
          const id = String(defect.inspectionId).trim();
          if (!defectsByInspectionId.has(id)) {
            defectsByInspectionId.set(id, []);
          }
          defectsByInspectionId.get(id)!.push(defect);
        }
        if (defect.pipeSegmentReference) {
          const ref = String(defect.pipeSegmentReference).trim();
          if (!defectsByPipeSegRef.has(ref)) {
            defectsByPipeSegRef.set(ref, []);
          }
          defectsByPipeSegRef.get(ref)!.push(defect);
        }
      }
      console.log(`Organized ${defects.length} defects: ${defectsByInspectionId.size} by inspection ID, ${defectsByPipeSegRef.size} by pipe segment reference`);
    }

    // Process each asset with its inspections
    for (const asset of assets) {
      // Primary: Use FID from GeoJSON as the asset key (FID should match Pipe Segment Reference)
      const fid = asset.properties?.FID || asset.properties?.fid || asset.properties?.Fid;
      const assetKey = fid ? String(fid).trim() : 
                       (asset.properties?.id || asset.properties?.assetId || asset.properties?.ASSET_ID ||
                        `asset-${assets.indexOf(asset)}`);
      const assetKeyStr = String(assetKey).trim();
      
      const assetInspections = matchedInspections.get(assetKeyStr) || [];
      
      if (assetInspections.length === 0) {
        continue;
      }

      // Get display identifier for logging (FID is the primary identifier)
      const displayId = fid ? `FID: ${fid}` : 
                        (asset.properties?.id || asset.properties?.assetId || assetKeyStr);
      console.log(`Processing ${assetInspections.length} inspections for asset: ${displayId}`);
      
      for (const inspection of assetInspections) {
        // Find defects associated with this inspection
        const inspectionDefects: DefectRecord[] = [];
        const inspectionId = inspection.properties?.Inspection_ID || inspection.properties?.InspectionID || 
                            inspection.properties?.inspection_id || inspection.properties?.['Inspection ID'];
        
        if (inspectionId) {
          const id = String(inspectionId).trim();
          const defectsById = defectsByInspectionId.get(id) || defectsByInspectionId.get(id.toLowerCase()) || [];
          inspectionDefects.push(...defectsById);
        }
        
        // Also try pipe segment reference
        if (inspection.pipeSegmentReference) {
          const ref = String(inspection.pipeSegmentReference).trim();
          const defectsByRef = defectsByPipeSegRef.get(ref) || defectsByPipeSegRef.get(ref.toLowerCase()) || [];
          // Avoid duplicates
          for (const defect of defectsByRef) {
            if (!inspectionDefects.find(d => d.id === defect.id)) {
              inspectionDefects.push(defect);
            }
          }
        }
        
        // Process defects: calculate positions if they have distance/clock position
        for (const defect of inspectionDefects) {
          if (defect.distance !== undefined && defect.clockPosition !== undefined && defect.clockPosition >= 0) {
            try {
              const defectCoordinates = calculateLateralPosition(
                asset,
                defect.distance,
                defect.clockPosition
              ) as [number, number];
              
              defect.coordinates = defectCoordinates;
              processedDefects.push(defect);
              defectCount++;
            } catch (error) {
              console.warn(`Error calculating defect position for defect ${defect.id}:`, error);
              // Still add defect without coordinates
              processedDefects.push(defect);
              defectCount++;
            }
          } else {
            // Defect without position - still add it but use asset center or lateral position
            processedDefects.push(defect);
            defectCount++;
          }
        }
        
        if (
          !inspection.tapDistance ||
          inspection.clockPosition === undefined ||
          inspection.clockPosition === null
        ) {
          skippedCount++;
          console.warn('Inspection missing required fields:', inspection);
          continue;
        }

        try {
          // Calculate lateral stub line (3ft perpendicular to mainline)
          let stubLine: [[number, number], [number, number]] | undefined;
          let connectionPoint: [number, number] | undefined;
          
          try {
            const stubResult = calculateLateralStub(
              asset,
              inspection.tapDistance,
              inspection.clockPosition
            );
            
            // Validate connection point
            const validatedConnectionPoint = validateCoordinates(stubResult.connectionPoint as [number, number]);
            if (!validatedConnectionPoint) {
              console.warn(`Invalid connection point for lateral: ${stubResult.connectionPoint}`);
            } else {
              connectionPoint = validatedConnectionPoint;
            }
            
            // Validate stub line coordinates
            const validatedStart = validateCoordinates(stubResult.stubLine[0] as [number, number]);
            const validatedEnd = validateCoordinates(stubResult.stubLine[1] as [number, number]);
            
            if (validatedStart && validatedEnd) {
              stubLine = [validatedStart, validatedEnd];
            } else {
              console.warn(`Invalid stub line coordinates for lateral`);
            }
          } catch (stubError) {
            console.warn(`Error calculating stub line for lateral:`, stubError);
            // Continue without stub line - will fall back to point
          }
          
          // Calculate lateral position (for backward compatibility and coordinates field)
          const coordinates = calculateLateralPosition(
            asset,
            inspection.tapDistance,
            inspection.clockPosition
          ) as [number, number];
          
          // Validate coordinates are in WGS84 [lng, lat] format using shared validation function
          const validatedCoordinates = validateCoordinates(coordinates);
          if (!validatedCoordinates) {
            console.warn(`Invalid coordinates for lateral: ${coordinates}`);
            skippedCount++;
            continue;
          }
          
          // Get asset reference point for creating line (for backward compatibility)
          let assetCoordinates: [number, number] | undefined;
          let rawAssetCoords: [number, number] | null = null;
          
          if (asset.geometry.type === 'Point') {
            rawAssetCoords = asset.geometry.coordinates as [number, number];
          } else if (asset.geometry.type === 'LineString') {
            if (asset.geometry.coordinates.length > 0) {
              rawAssetCoords = asset.geometry.coordinates[0] as [number, number];
            }
          } else if (asset.geometry.type === 'MultiLineString') {
            const firstLine = asset.geometry.coordinates[0];
            if (firstLine && firstLine.length > 0) {
              rawAssetCoords = firstLine[0] as [number, number];
            }
          }
          
          if (rawAssetCoords) {
            // Validate asset coordinates using shared validation function
            const validatedAssetCoords = validateCoordinates(rawAssetCoords);
            if (validatedAssetCoords) {
              assetCoordinates = validatedAssetCoords;
            } else {
              console.warn(`Asset coordinates invalid: [${rawAssetCoords[0]}, ${rawAssetCoords[1]}]`);
            }
          }

          // Reverse geocode to get address (with timeout to avoid hanging)
          let address = 'Address not found';
          let addressDetails = {};
          
          try {
            const geocodingResult = await Promise.race([
              reverseGeocode(validatedCoordinates[0], validatedCoordinates[1]),
              new Promise<{ address: string; details: any }>((_, reject) => 
                setTimeout(() => reject(new Error('Geocoding timeout')), 5000)
              )
            ]);
            address = geocodingResult.address;
            addressDetails = geocodingResult.details;
          } catch (geocodeError) {
            console.warn('Geocoding failed for lateral:', geocodeError);
            // Continue without address
          }

          const lateral: LateralInspection = {
            id: `lateral-${assetKeyStr}-${inspection.tapDistance}-${inspection.clockPosition}-${processedCount}`,
            coordinates: validatedCoordinates,
            assetCoordinates,
            connectionPoint,
            stubLine,
            assetId: assetKeyStr,
            tapDistance: inspection.tapDistance,
            clockPosition: inspection.clockPosition,
            address,
            addressDetails,
            inspectionDate: inspection.inspectionDate,
            properties: {
              ...inspection,
              assetId: assetKeyStr,
              pipeSegmentReference: inspection.pipeSegmentReference,
              defectCount: inspectionDefects.length,
            },
          };

          laterals.push(lateral);
          processedCount++;
        } catch (error) {
          skippedCount++;
          console.error(`Error processing lateral for asset ${assetKeyStr}:`, error);
          // Continue processing other laterals
        }
      }
    }

    // Convert taps to laterals if provided
    if (taps && taps.length > 0 && lateralLayerName) {
      console.log(`Converting ${taps.length} taps to laterals with layer name: ${lateralLayerName}`);
      
      for (let i = 0; i < taps.length; i++) {
        const tap = taps[i];
        
        // Validate and fix coordinates using shared validation function
        const validatedCoordinates = validateCoordinates(tap.coordinates);
        if (!validatedCoordinates) {
          console.warn(`Invalid coordinates for tap lateral: ${tap.coordinates}`);
          continue;
        }
        
        // Find the asset to calculate stub line
        let assetCoordinates: [number, number] | undefined;
        let stubLine: [[number, number], [number, number]] | undefined;
        let connectionPoint: [number, number] | undefined;
        
        if (tap.assetId) {
          const assetIdStr = String(tap.assetId).trim();
          const asset = assets.find(a => {
            const assetFid = a.properties?.FID || a.properties?.fid || a.properties?.Fid;
            return assetFid && String(assetFid).trim() === assetIdStr;
          });
          
          if (asset) {
            // Calculate stub line for tap-based lateral
            try {
              const stubResult = calculateLateralStub(
                asset,
                tap.distance,
                tap.clockPosition
              );
              
              // Validate connection point
              const validatedConnectionPoint = validateCoordinates(stubResult.connectionPoint as [number, number]);
              if (validatedConnectionPoint) {
                connectionPoint = validatedConnectionPoint;
              }
              
              // Validate stub line coordinates
              const validatedStart = validateCoordinates(stubResult.stubLine[0] as [number, number]);
              const validatedEnd = validateCoordinates(stubResult.stubLine[1] as [number, number]);
              
              if (validatedStart && validatedEnd) {
                stubLine = [validatedStart, validatedEnd];
              }
            } catch (stubError) {
              console.warn(`Error calculating stub line for tap lateral:`, stubError);
            }
            
            // Get asset reference point (for backward compatibility)
            let rawAssetCoords: [number, number] | null = null;
            
            if (asset.geometry.type === 'Point') {
              rawAssetCoords = asset.geometry.coordinates as [number, number];
            } else if (asset.geometry.type === 'LineString') {
              if (asset.geometry.coordinates.length > 0) {
                rawAssetCoords = asset.geometry.coordinates[0] as [number, number];
              }
            } else if (asset.geometry.type === 'MultiLineString') {
              const firstLine = asset.geometry.coordinates[0];
              if (firstLine && firstLine.length > 0) {
                rawAssetCoords = firstLine[0] as [number, number];
              }
            }
            
            if (rawAssetCoords) {
              // Validate asset coordinates using shared validation function
              const validatedAssetCoords = validateCoordinates(rawAssetCoords);
              if (validatedAssetCoords) {
                assetCoordinates = validatedAssetCoords;
              } else {
                console.warn(`Asset coordinates invalid: [${rawAssetCoords[0]}, ${rawAssetCoords[1]}]`);
              }
            }
          }
        }
        
        const lateral: LateralInspection = {
          id: `lateral-tap-${lateralLayerName}-${i}`,
          coordinates: validatedCoordinates,
          assetCoordinates,
          connectionPoint,
          stubLine,
          assetId: tap.assetId,
          tapDistance: tap.distance,
          clockPosition: tap.clockPosition,
          address: tap.address,
          addressDetails: tap.addressDetails,
          inspectionDate: tap.inspectionDate,
          properties: {
            layerName: lateralLayerName,
            pipeSegmentReference: tap.address, // Use address as lateral segment reference
            defectCode: tap.defectCode,
            inspectionId: tap.inspectionId,
            originalPipeSegmentReference: tap.pipeSegmentReference, // Keep original for reference
            source: 'tap',
            ...tap.properties,
          },
        };
        
        laterals.push(lateral);
        processedCount++;
      }
      
      console.log(`Converted ${taps.length} taps to laterals`);
    }

    console.log(`Processed ${processedCount} laterals, ${defectCount} defects, skipped ${skippedCount}`);

    const processedData: ProcessedData = {
      assets,
      inspections,
      laterals,
      defects: processedDefects,
    };

    return NextResponse.json({
      success: true,
      data: processedData,
      stats: {
        assetsCount: assets.length,
        inspectionsCount: inspections.length,
        lateralsCount: laterals.length,
        defectsCount: defectCount,
        processedCount,
        skippedCount,
        tapBasedLateralsCount: taps && taps.length > 0 ? taps.length : 0,
      },
    });
  } catch (error) {
    console.error('Processing error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to process data' },
      { status: 500 }
    );
  }
}

