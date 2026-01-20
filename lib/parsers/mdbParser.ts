import { InspectionRecord, DefectRecord } from '../types';

// Note: MDB parsing in Node.js is complex. This is a simplified parser.
// For production, you may need to use a different approach or library.
// This assumes we can extract data from MDB files using mdb-js or similar.

export interface MDBTable {
  name: string;
  rows: Record<string, any>[];
}

export async function parseMDBFile(file: File | Buffer): Promise<InspectionRecord[]> {
  // Since MDB parsing requires special libraries and may need to run on server,
  // we'll create a structure that can work with various MDB parsing approaches
  
  // For now, this is a placeholder that expects the MDB to be parsed elsewhere
  // In a real implementation, you might use:
  // - mdb-js (limited support)
  // - node-adodb (requires Windows/COM)
  // - Convert MDB to CSV first
  // - Use a Python microservice
  
  throw new Error('MDB parsing requires server-side implementation. Please use the API endpoint.');
}

export function extractInspectionData(
  rawInspections: Record<string, any>[],
  fields?: { inspectionIdField?: string | null; pipeRefField?: string | null }
): InspectionRecord[] {
  return rawInspections
    .map((r) => {
      // Use detected field names if provided, otherwise try common variations
      const inspectionIdField = fields?.inspectionIdField || 'InspectionID';
      const pipeRefField = fields?.pipeRefField || 'Pipe_Segment_Reference';
      
      const inspectionId = r[inspectionIdField];
      const pipeRef = r[pipeRefField];

      // ✅ only require the two fields we truly need
      if (inspectionId == null || pipeRef == null) return null;

      // Extract other optional fields
      const direction = r['Direction'] ?? r['direction'] ?? null;
      const reverseSetup = r['Reverse_Setup'] ?? r['Reverse Setup'] ?? r['reverse_setup'] ?? null;
      const isImperial = r['IsImperial'] ?? r['isImperial'] ?? r['Is Imperial'] ?? null;
      const lengthSurveyed = r['Length_Surveyed'] ?? r['Length Surveyed'] ?? r['length_surveyed'] ?? null;
      const upstreamMH = r['Upstream_MH'] ?? r['Upstream MH'] ?? r['upstream_mh'] ?? null;
      const downstreamMH = r['Downstream_MH'] ?? r['Downstream MH'] ?? r['downstream_mh'] ?? null;

      return {
        assetId: String(pipeRef).trim(), // Use pipeRef as assetId for matching
        pipeSegmentReference: String(pipeRef).trim(),
        inspectionId: String(inspectionId),
        // Note: tapDistance and clockPosition are NOT in PACP_Inspections
        // They come from PACP_Conditions (defect data) or LACP tables
        inspectionDate: r['Inspection_Date'] ?? r['Inspection Date'] ?? r['inspection_date'] ?? r['Date'] ?? r['date'] ?? undefined,
        direction: direction != null ? String(direction) : undefined,
        reverseSetup,
        isImperial: isImperial != null ? (typeof isImperial === 'number' ? isImperial : Number(isImperial)) : undefined,
        lengthSurveyed: lengthSurveyed != null ? (typeof lengthSurveyed === 'number' ? lengthSurveyed : Number(lengthSurveyed)) : undefined,
        upstreamMH: upstreamMH != null ? String(upstreamMH) : undefined,
        downstreamMH: downstreamMH != null ? String(downstreamMH) : undefined,
        raw: r,
        ...r, // Include all original fields
      } as InspectionRecord;
    })
    .filter(Boolean) as InspectionRecord[];
}

export function matchInspectionsToAssets(
  inspections: InspectionRecord[],
  assets: any[]
): Map<string, InspectionRecord[]> {
  const matched = new Map<string, InspectionRecord[]>();

  // Create maps for both Pipe Segment Reference and Asset ID matching
  const pipeSegmentRefMap = new Map<string, string>(); // pipeSegmentRef -> asset key
  const assetIdMap = new Map<string, string>(); // assetId -> asset key
  
  // Build lookup maps from assets
  for (const asset of assets) {
    // Primary: Use FID from GeoJSON as the asset key
    const fid = asset.properties?.FID || asset.properties?.fid || asset.properties?.Fid;
    
    // Fallback asset key if FID not available
    const assetKey = fid ? String(fid).trim() : 
                     (asset.properties?.id || asset.properties?.assetId || asset.properties?.ASSET_ID || 
                      `asset-${assets.indexOf(asset)}`);
    
    // FID should match Pipe Segment Reference, so use FID as the pipe segment reference
    if (fid) {
      const fidStr = String(fid).trim();
      // Map FID to asset key for matching
      pipeSegmentRefMap.set(fidStr, assetKey);
      pipeSegmentRefMap.set(fidStr.toLowerCase(), assetKey);
      // Also try with different formats (in case of type mismatches)
      const fidNum = Number(fid);
      if (!isNaN(fidNum)) {
        pipeSegmentRefMap.set(String(fidNum), assetKey);
        pipeSegmentRefMap.set(String(fidNum).toLowerCase(), assetKey);
      }
    }
    
    // Extract Asset ID from asset properties (fallback only)
    const assetId = 
      asset.properties?.id || asset.properties?.assetId || asset.properties?.ASSET_ID ||
      asset.properties?.Asset_ID || asset.properties?.ASSETID || asset.properties?.AssetId ||
      asset.properties?.STATION_ID || asset.properties?.StationID || asset.properties?.station_id ||
      asset.properties?.PIPE_ID || asset.properties?.PipeID || asset.properties?.pipe_id ||
      asset.properties?.ID || asset.properties?.Id;
    
    // Add to asset ID map (fallback matching only)
    if (assetId && !fid) {
      const idStr = String(assetId).trim();
      assetIdMap.set(idStr, assetKey);
      assetIdMap.set(idStr.toLowerCase(), assetKey);
    }
  }

  console.log(`Built lookup maps: ${pipeSegmentRefMap.size / 2} pipe segment references, ${assetIdMap.size / 2} asset IDs`);

  // Match inspections to assets
  // CRITICAL: FID from GeoJSON must match Pipe Segment Reference from PACP_Inspections
  for (const inspection of inspections) {
    let matchedKey: string | undefined;
    
    // Priority 1: Match by Pipe Segment Reference (this should match FID)
    if (inspection.pipeSegmentReference) {
      const refStr = String(inspection.pipeSegmentReference).trim();
      
      // Try exact match first
      matchedKey = pipeSegmentRefMap.get(refStr);
      
      // Try case-insensitive match
      if (!matchedKey) {
        matchedKey = pipeSegmentRefMap.get(refStr.toLowerCase());
      }
      
      // Try numeric conversion if refStr is a number
      if (!matchedKey) {
        const refNum = Number(refStr);
        if (!isNaN(refNum)) {
          matchedKey = pipeSegmentRefMap.get(String(refNum)) || pipeSegmentRefMap.get(String(refNum).toLowerCase());
        }
      }
      
      // Try removing leading zeros or formatting differences
      if (!matchedKey && /^\d+$/.test(refStr)) {
        const normalizedRef = String(parseInt(refStr, 10));
        matchedKey = pipeSegmentRefMap.get(normalizedRef) || pipeSegmentRefMap.get(normalizedRef.toLowerCase());
      }
      
      if (matchedKey) {
        if (!matched.has(matchedKey)) {
          matched.set(matchedKey, []);
        }
        matched.get(matchedKey)!.push(inspection);
        continue;
      } else {
        // Log unmatched for debugging
        if (inspections.indexOf(inspection) < 5) {
          console.log('Unmatched inspection (Pipe Segment Reference):', {
            pipeSegmentRef: refStr,
            availableRefs: Array.from(pipeSegmentRefMap.keys()).filter((_, i) => i % 2 === 0).slice(0, 10),
          });
        }
      }
    }
    
    // Priority 2: Match by Asset ID (fallback)
    if (inspection.assetId) {
      const inspectionAssetId = String(inspection.assetId).trim();
      matchedKey = assetIdMap.get(inspectionAssetId) || assetIdMap.get(inspectionAssetId.toLowerCase());
      
      if (matchedKey) {
        if (!matched.has(matchedKey)) {
          matched.set(matchedKey, []);
        }
        matched.get(matchedKey)!.push(inspection);
        continue;
      }
    }
    
    // Log unmatched inspections for debugging
    if (!matchedKey) {
      console.warn('Unmatched inspection:', {
        pipeSegmentRef: inspection.pipeSegmentReference,
        assetId: inspection.assetId,
        availableRefs: Array.from(pipeSegmentRefMap.keys()).filter((_, i) => i % 2 === 0).slice(0, 5),
        availableIds: Array.from(assetIdMap.keys()).filter((_, i) => i % 2 === 0).slice(0, 5),
      });
    }
  }

  console.log(`Matched ${matched.size} assets with inspections out of ${assets.length} total assets`);
  return matched;
}

export function extractDefectData(
  rows: Record<string, any>[],
  fields?: {
    inspectionIdField?: string | null;
    pipeRefField?: string | null;
    distanceField?: string | null;
    codeField?: string | null;
    gradeField?: string | null;
  }
): DefectRecord[] {
  const defects: DefectRecord[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    // Helper function to find field by pattern
    const findField = (patterns: string[]): string | undefined => {
      for (const pattern of patterns) {
        // Try exact match first
        if (row[pattern] !== undefined) return row[pattern];
        // Try case-insensitive match
        const key = Object.keys(row).find(k => k.toLowerCase() === pattern.toLowerCase());
        if (key && row[key] !== undefined) return row[key];
      }
      return undefined;
    };
    
    // Use detected field names if provided, otherwise try common variations
    const inspectionIdField = fields?.inspectionIdField || 'InspectionID';
    const pipeRefField = fields?.pipeRefField || 'Pipe_Segment_Reference';
    const distanceField = fields?.distanceField || 'Distance';
    const codeField = fields?.codeField || 'PACP_Code';
    const gradeField = fields?.gradeField || 'Grade';
    
    // Find inspection ID or pipe segment reference to link defect to inspection
    const inspectionId = row[inspectionIdField] || findField([
      'INSPECTION_ID', 'InspectionID', 'inspection_id', 'Inspection ID',
      'INSPECTIONID', 'InspectionId', 'inspectionId',
      'ID', 'id', 'Id',
    ]);
    
    const pipeSegmentRef = row[pipeRefField] || findField([
      'PIPE_SEGMENT_REFERENCE', 'PipeSegmentReference', 'pipe_segment_reference', 'Pipe Segment Reference',
      'PIPE_SEG_REF', 'PipeSegRef', 'pipe_seg_ref', 'Pipe Seg Ref',
      'SEGMENT_REFERENCE', 'SegmentReference', 'segment_reference', 'Segment Reference',
      'SEGMENT_REF', 'SegmentRef', 'segment_ref', 'Segment Ref',
      'PIPE_REF', 'PipeRef', 'pipe_ref', 'Pipe Ref',
      'REFERENCE', 'Reference', 'reference',
      'PSR', 'psr', 'PSRef', 'psref',
    ]);
    
    // Find defect code
    const defectCode = row[codeField] || findField([
      'DEFECT_CODE', 'DefectCode', 'defect_code', 'Defect Code',
      'CODE', 'Code', 'code',
      'CONDITION_CODE', 'ConditionCode', 'condition_code', 'Condition Code',
      'NASSCO_CODE', 'NasscoCode', 'nassco_code',
    ]);
    
    // Find defect description
    const defectDescription = findField([
      'DEFECT_DESCRIPTION', 'DefectDescription', 'defect_description', 'Defect Description',
      'DESCRIPTION', 'Description', 'description',
      'CONDITION_DESCRIPTION', 'ConditionDescription', 'condition_description',
      'COMMENTS', 'Comments', 'comments', 'Comment', 'comment',
    ]);
    
    // Find grade/severity
    const grade = row[gradeField] || findField([
      'GRADE', 'Grade', 'grade',
      'SEVERITY', 'Severity', 'severity',
      'RATING', 'Rating', 'rating',
      'SCORE', 'Score', 'score',
    ]);
    
    // Find distance and clock position (if defect has its own position)
    const distanceStr = row[distanceField] || findField([
      'DISTANCE', 'Distance', 'distance',
      'DEFECT_DISTANCE', 'DefectDistance', 'defect_distance',
      'OFFSET', 'Offset', 'offset',
      'Distance_Along_Pipe', 'Distance Along Pipe',
    ]);
    
    const clockPositionStr = findField([
      'CLOCK_POSITION', 'ClockPosition', 'clock_position', 'Clock Position',
      'CLOCK_POS', 'ClockPos', 'clock_pos',
      'CLOCK', 'Clock', 'clock',
      'POSITION', 'Position', 'position',
    ]);
    
    const distance = distanceStr ? parseFloat(String(distanceStr).replace(/[^0-9.-]/g, '')) : undefined;
    const clockPosition = clockPositionStr ? parseFloat(String(clockPositionStr).replace(/[^0-9.-]/g, '')) : undefined;
    
    // Only include defects that have at least an inspection ID or pipe segment reference
    const hasLink = inspectionId || pipeSegmentRef;
    
    if (hasLink) {
      const defect: DefectRecord = {
        id: `defect-${inspectionId || pipeSegmentRef || i}-${i}`,
        inspectionId: inspectionId ? String(inspectionId).trim() : undefined,
        pipeSegmentReference: pipeSegmentRef ? String(pipeSegmentRef).trim() : undefined,
        defectCode: defectCode ? String(defectCode).trim() : undefined,
        defectDescription: defectDescription ? String(defectDescription).trim() : undefined,
        grade: grade !== undefined ? (typeof grade === 'number' ? grade : String(grade).trim()) : undefined,
        distance: distance !== undefined && distance >= 0 ? distance : undefined,
        clockPosition: clockPosition !== undefined && clockPosition >= 0 ? clockPosition : undefined,
        properties: { ...row },
      };
      
      defects.push(defect);
      
      // Log first few defects for debugging
      if (i < 5) {
        console.log(`Defect ${i}:`, {
          inspectionId: defect.inspectionId,
          pipeSegmentRef: defect.pipeSegmentReference,
          defectCode: defect.defectCode,
          grade: defect.grade,
          hasDistance: defect.distance !== undefined,
          hasClockPosition: defect.clockPosition !== undefined,
        });
      }
    }
  }
  
  console.log(`Extracted ${defects.length} defects from ${rows.length} rows`);
  return defects;
}

