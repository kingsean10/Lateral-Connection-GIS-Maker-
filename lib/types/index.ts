import { Feature, Point, LineString, MultiLineString } from 'geojson';

export interface SewerAsset extends Feature<Point | LineString | MultiLineString> {
  properties: {
    id?: string;
    assetId?: string;
    [key: string]: any;
  };
}

export interface InspectionRecord {
  assetId?: string;
  pipeSegmentReference?: string;
  inspectionId?: string;
  tapDistance?: number;
  clockPosition?: number;
  inspectionDate?: string;
  direction?: string | null;
  reverseSetup?: any;
  isImperial?: number | null;
  lengthSurveyed?: number | null;
  upstreamMH?: string | null;
  downstreamMH?: string | null;
  raw?: Record<string, any>;
  [key: string]: any;
}

export interface LateralInspection {
  id: string;
  coordinates: [number, number]; // Lateral endpoint coordinates [lng, lat]
  assetCoordinates?: [number, number]; // Asset reference point [lng, lat] for creating line
  connectionPoint?: [number, number]; // Point on mainline where lateral connects [lng, lat]
  stubLine?: [[number, number], [number, number]]; // Stub line coordinates: [connectionPoint, stubEndPoint]
  assetId?: string;
  tapDistance: number;
  clockPosition: number;
  address?: string;
  addressDetails?: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    fullAddress?: string;
  };
  inspectionDate?: string;
  properties?: Record<string, any>;
}

export interface DefectRecord {
  id: string;
  inspectionId?: string;
  pipeSegmentReference?: string;
  defectCode?: string;
  defectDescription?: string;
  grade?: number | string;
  distance?: number;
  clockPosition?: number;
  coordinates?: [number, number];
  address?: string;
  addressDetails?: GeocodingResult['details'];
  properties: Record<string, any>;
}

export interface TapInspection {
  id: string;
  coordinates: [number, number];
  assetId: string;
  pipeSegmentReference?: string;
  inspectionId?: string;
  defectCode?: string;
  distance: number;
  clockPosition: number;
  address: string;
  addressDetails?: GeocodingResult['details'];
  inspectionDate?: string;
  properties?: Record<string, any>;
}

export interface ProcessedData {
  assets: SewerAsset[];
  inspections: InspectionRecord[];
  laterals: LateralInspection[];
  defects?: DefectRecord[];
}

export interface GeocodingResult {
  address: string;
  details: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    fullAddress?: string;
  };
}

export interface TableInfo {
  name: string;
  columnCount: number;
  rowCount: number;
  columns: string[];
  sampleRow?: Record<string, any>;
  inspectionFields: string[];
  defectFields: string[];
  score?: number;
}

export interface TableScore {
  name: string;
  score: number;
  columnCount: number;
  rowCount: number;
  inspectionFields: string[];
  defectFields: string[];
  sampleFields: string[];
}

