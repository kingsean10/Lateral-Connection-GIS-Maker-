import { NextRequest, NextResponse } from 'next/server';
import { extractInspectionData, extractDefectData } from '@/lib/parsers/mdbParser';
import { InspectionRecord, DefectRecord } from '@/lib/types';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Papa from 'papaparse';

const execFileAsync = promisify(execFile);

export const runtime = 'nodejs'; // IMPORTANT: needs Node runtime (not edge)

function runMdbExport(mdbPath: string, table: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'mdb-export',
      [
        // ✅ DO NOT use -H (it hides headers)
        '-D',
        '%Y-%m-%d %H:%M:%S',
        mdbPath,
        table,
      ],
      { maxBuffer: 50 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr || err.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function parseCsv(csv: string) {
  const parsed = Papa.parse<Record<string, any>>(csv, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
  });

  if (parsed.errors?.length) {
    // Don't hard fail on minor parse warnings; but do fail if no data
    // console.warn(parsed.errors);
  }

  return parsed.data;
}

function normalizeKey(s: string) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pickField(columns: string[], candidates: string[]) {
  const normCols = columns.map((c) => ({ c, n: normalizeKey(c) }));
  for (const cand of candidates) {
    const nCand = normalizeKey(cand);
    const hit = normCols.find((x) => x.n === nCand);
    if (hit) return hit.c;
  }
  return null;
}

export async function POST(req: NextRequest) {
  let tempDir: string | null = null;
  let mdbPath: string | null = null;

  try {
    const form = await req.formData();
    const file = form.get('file') as File;
    const jsonData = form.get('jsonData') as string; // Alternative: pre-parsed JSON

    if (!file && !jsonData) {
      return NextResponse.json(
        { error: 'No file or JSON data provided' },
        { status: 400 }
      );
    }

    let inspections: InspectionRecord[] = [];
    let defects: DefectRecord[] = [];
    let rawInspections: Record<string, any>[] = [];
    let rawConditions: Record<string, any>[] = [];
    let inspectionColumns: string[] = [];
    let conditionColumns: string[] = [];

    if (jsonData) {
      // If JSON data is provided (pre-parsed MDB)
      try {
        const data = JSON.parse(jsonData);
        if (Array.isArray(data)) {
          rawInspections = data;
          inspections = extractInspectionData(data);
        } else if (data.rows && Array.isArray(data.rows)) {
          rawInspections = data.rows;
          inspections = extractInspectionData(data.rows);
        } else {
          return NextResponse.json(
            { error: 'Invalid JSON format. Expected array or object with rows array' },
            { status: 400 }
          );
        }
        // For JSON data, create column names from first row
        if (rawInspections.length > 0) {
          inspectionColumns = Object.keys(rawInspections[0]);
        }
      } catch (error) {
        return NextResponse.json(
          { error: 'Invalid JSON data: ' + (error as Error).message },
          { status: 400 }
        );
      }
    } else if (file) {
      // Handle MDB file
      if (!file.name.toLowerCase().endsWith('.mdb') && !file.name.toLowerCase().endsWith('.accdb')) {
        return NextResponse.json(
          { error: 'File must be an MDB or ACCDB file' },
          { status: 400 }
        );
      }

      // Write upload to a temp file
      const bytes = Buffer.from(await file.arrayBuffer());
      tempDir = await mkdtemp(join(tmpdir(), 'mdb-'));
      mdbPath = join(tempDir, file.name);
      await writeFile(mdbPath, bytes);

      try {
        // Export the two tables we need (headers included)
        const inspectionsCsv = await runMdbExport(mdbPath, 'PACP_Inspections');
        rawInspections = parseCsv(inspectionsCsv);
        
        inspectionColumns = rawInspections.length ? Object.keys(rawInspections[0]) : [];
        
        // Try to export PACP_Conditions, but don't fail if it doesn't exist
        try {
          const conditionsCsv = await runMdbExport(mdbPath, 'PACP_Conditions');
          rawConditions = parseCsv(conditionsCsv);
          conditionColumns = rawConditions.length ? Object.keys(rawConditions[0]) : [];
        } catch (conditionsError) {
          console.warn('Could not export PACP_Conditions table:', (conditionsError as Error).message);
          rawConditions = [];
          conditionColumns = [];
        }

        // HARD GUARD: if "columns" look like values, fail early
        // Column names that look like data values (not field names)
        const looksBroken =
          inspectionColumns.length > 0 &&
          inspectionColumns.some((k) => {
            // Check if column name looks like a data value rather than a field name
            // Data values often: are pure numbers, contain dates/slashes in wrong places, 
            // are very long without spaces, or don't start with letters/underscores
            return (
              /^\d+$/.test(k) || // Pure numbers
              (k.includes('/') && !k.includes(' ')) || // Dates without context
              (k.length > 50 && !k.includes(' ')) || // Very long single words
              (!/^[A-Za-z_]/.test(k) && !k.includes(' ')) // Doesn't start with letter/underscore and no spaces
            );
          });

        if (looksBroken) {
          return NextResponse.json(
            {
              error:
                'MDB extraction still looks broken (headers look like values). Confirm mdbtools installed and mdb-export is being used.',
              inspectionColumns: inspectionColumns.slice(0, 10),
            },
            { status: 500 }
          );
        }

        // Find key fields (names vary across exports)
        const inspectionIdField = pickField(inspectionColumns, [
          'InspectionID',
          'Inspection_Id',
          'Inspection ID',
          'InspecID',
          'Inspec_Id',
        ]);

        const pipeRefField = pickField(inspectionColumns, [
          'Pipe_Segment_Reference',
          'Pipe Segment Reference',
          'PipeSegmentReference',
          'PipeID',
          'Pipe Id',
          'SegmentReference',
        ]);

        const conditionInspectionIdField = pickField(conditionColumns, [
          'InspectionID',
          'Inspection_Id',
          'Inspection ID',
          'InspecID',
        ]);

        const distanceField = pickField(conditionColumns, [
          'Distance',
          'Dist',
          'Distance_Along_Pipe',
          'Distance Along Pipe',
        ]);

        const codeField = pickField(conditionColumns, [
          'PACP_Code',
          'PACP Code',
          'Code',
          'DefectCode',
          'ConditionCode',
        ]);

        const gradeField = pickField(conditionColumns, [
          'Grade',
          'Severity',
          'PACP_Grade',
          'PACP Grade',
        ]);

        // Process raw data into structured format using existing extractors
        // Pass detected field names to extractor
        inspections = extractInspectionData(rawInspections, {
          inspectionIdField,
          pipeRefField,
        });
        defects = extractDefectData(rawConditions, {
          inspectionIdField: conditionInspectionIdField,
          pipeRefField, // Use the same pipeRefField from inspections
          distanceField,
          codeField,
          gradeField,
        });

        console.log('MDB parsed successfully:', {
          inspectionsCount: inspections.length,
          conditionsCount: rawConditions.length,
          defectsCount: defects.length,
          inspectionColumns: inspectionColumns.slice(0, 10),
          conditionColumns: conditionColumns.slice(0, 10),
          fields: {
            inspectionIdField,
            pipeRefField,
            conditionInspectionIdField,
            distanceField,
            codeField,
            gradeField,
          },
        });

        return NextResponse.json({
          success: true,
          inspections,
          defects,
          rawInspections,
          rawConditions,
          inspectionColumns,
          conditionColumns,
          fields: {
            inspectionIdField,
            pipeRefField,
            conditionInspectionIdField,
            distanceField,
            codeField,
            gradeField,
          },
          count: inspections.length,
          defectCount: defects.length,
          sampleInspection: rawInspections[0] ?? null,
          sampleCondition: rawConditions[0] ?? null,
        });
      } catch (exportError) {
        const errorMessage = (exportError as Error).message || 'Failed to parse MDB file';
        
        // Check if mdb-tools is available
        try {
          await execFileAsync('which', ['mdb-export']);
        } catch {
          return NextResponse.json(
            {
              error: 'MDB parsing requires mdbtools. Please install it first.',
              suggestion: 'On macOS: brew install mdbtools\nOn Linux: sudo apt-get install mdbtools',
              details: errorMessage,
            },
            { status: 500 }
          );
        }

        return NextResponse.json(
          {
            error: 'Failed to parse MDB file',
            details: errorMessage,
            suggestion: 'Make sure the MDB file is not corrupted and contains PACP_Inspections and PACP_Conditions tables.',
          },
          { status: 500 }
        );
      } finally {
        // Clean up temp files
        if (mdbPath) {
          try {
            await unlink(mdbPath);
          } catch {}
        }
        if (tempDir) {
          try {
            const fs = await import('fs/promises');
            await fs.rmdir(tempDir, { recursive: true });
          } catch {}
        }
      }
    }

    // Return JSON data response
    return NextResponse.json({
      success: true,
      inspections,
      defects,
      rawInspections,
      rawConditions,
      inspectionColumns,
      conditionColumns,
      count: inspections.length,
      defectCount: defects.length,
    });
  } catch (error) {
    // Clean up temp files if they exist
    if (mdbPath) {
      try {
        await unlink(mdbPath);
      } catch {}
    }
    if (tempDir) {
      try {
        const fs = await import('fs/promises');
        await fs.rmdir(tempDir, { recursive: true });
      } catch {}
    }

    console.error('MDB upload error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to process MDB file' },
      { status: 500 }
    );
  }
}
