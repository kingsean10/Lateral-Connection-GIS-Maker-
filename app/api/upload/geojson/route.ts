import { NextRequest, NextResponse } from 'next/server';
import { parseGeoJSON, validateGeoJSON } from '@/lib/parsers/geojsonParser';

// Increase body size limit for large GeoJSON files
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided. Please select a file to upload.' },
        { status: 400 }
      );
    }

    // Check file size (limit to 50MB)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: `File is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum size is 50MB.` },
        { status: 400 }
      );
    }

    // Check file extension
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.geojson') && !fileName.endsWith('.json')) {
      return NextResponse.json(
        { error: `File must be a GeoJSON file (.geojson or .json). Received: ${file.name}` },
        { status: 400 }
      );
    }

    let text: string;
    try {
      text = await file.text();
    } catch (readError) {
      return NextResponse.json(
        { error: 'Failed to read file. The file may be corrupted or in an unsupported format.' },
        { status: 400 }
      );
    }

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'File is empty. Please upload a valid GeoJSON file.' },
        { status: 400 }
      );
    }
    
    if (!validateGeoJSON(text)) {
      return NextResponse.json(
        { error: 'Invalid GeoJSON format. The file must be a valid GeoJSON FeatureCollection.' },
        { status: 400 }
      );
    }

    let assets;
    try {
      assets = parseGeoJSON(text);
    } catch (parseError) {
      console.error('GeoJSON parse error:', parseError);
      return NextResponse.json(
        { error: `Failed to parse GeoJSON: ${(parseError as Error).message}` },
        { status: 400 }
      );
    }

    if (assets.length === 0) {
      return NextResponse.json(
        { error: 'No valid features found in GeoJSON. Make sure your file contains Point or LineString features.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      assets,
      count: assets.length,
    });
  } catch (error) {
    console.error('GeoJSON upload error:', error);
    const errorMessage = (error as Error).message || 'Failed to process GeoJSON file';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

