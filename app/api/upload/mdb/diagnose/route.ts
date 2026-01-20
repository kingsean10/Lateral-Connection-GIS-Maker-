import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TableInfo } from '@/lib/types';

const execAsync = promisify(exec);

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add last field
  result.push(current.trim());
  
  return result;
}

async function analyzeTable(mdbPath: string, tableName: string): Promise<TableInfo> {
  try {
    const { stdout } = await execAsync(`mdb-export -H "${mdbPath}" "${tableName}"`);
    const lines = stdout.trim().split('\n');
    
    if (lines.length < 1) {
      return {
        name: tableName,
        columnCount: 0,
        rowCount: 0,
        columns: [],
        inspectionFields: [],
        defectFields: [],
      };
    }
    
    const headers = parseCSVLine(lines[0]);
    const dataRows = lines.slice(1).filter(line => line.trim().length > 0);
    
    // Sample row (first data row)
    let sampleRow: Record<string, any> | undefined;
    if (dataRows.length > 0) {
      const values = parseCSVLine(dataRows[0]);
      sampleRow = {};
      headers.forEach((header, i) => {
        const value = values[i] || '';
        const numValue = parseFloat(value);
        sampleRow![header] = isNaN(numValue) || value !== numValue.toString() ? value : numValue;
      });
    }
    
    // Identify inspection and defect fields
    const inspectionPatterns = [
      /pipe|segment|ref|tap|distance|clock|position|inspection|asset|fid|station/i,
    ];
    const defectPatterns = [
      /defect|code|grade|severity|condition|damage|break|crack|root|infiltration/i,
    ];
    
    const inspectionFields = headers.filter(h => 
      inspectionPatterns.some(pattern => pattern.test(h))
    );
    const defectFields = headers.filter(h => 
      defectPatterns.some(pattern => pattern.test(h))
    );
    
    return {
      name: tableName,
      columnCount: headers.length,
      rowCount: dataRows.length,
      columns: headers.slice(0, 20), // First 20 columns
      sampleRow,
      inspectionFields,
      defectFields,
    };
  } catch (error) {
    return {
      name: tableName,
      columnCount: 0,
      rowCount: 0,
      columns: [],
      inspectionFields: [],
      defectFields: [],
    };
  }
}

async function listTables(mdbPath: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`mdb-tables "${mdbPath}"`);
    return stdout.trim().split(/\s+/).filter(t => t.length > 0);
  } catch {
    try {
      const { stdout } = await execAsync(`mdb_export -T "${mdbPath}"`);
      const lines = stdout.split('\n');
      return lines
        .filter(line => line.trim().length > 0)
        .map(line => line.trim());
    } catch (err) {
      throw new Error('Could not list MDB tables. Make sure mdbtools is installed.');
    }
  }
}

export async function POST(request: NextRequest) {
  let tempFilePath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!file.name.toLowerCase().endsWith('.mdb') && !file.name.toLowerCase().endsWith('.accdb')) {
      return NextResponse.json(
        { error: 'File must be an MDB or ACCDB file' },
        { status: 400 }
      );
    }

    // Save file to temp directory
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    tempFilePath = join(tmpdir(), `mdb-diagnose-${Date.now()}-${Math.random().toString(36).substring(7)}.mdb`);
    await writeFile(tempFilePath, buffer);

    // List all tables
    const tables = await listTables(tempFilePath);
    
    if (tables.length === 0) {
      return NextResponse.json(
        { error: 'No tables found in MDB file' },
        { status: 400 }
      );
    }

    // Analyze each table
    const tableInfos: TableInfo[] = [];
    for (const tableName of tables) {
      const info = await analyzeTable(tempFilePath, tableName);
      tableInfos.push(info);
    }

    // Calculate scores for each table
    const scoredTables = tableInfos.map(table => {
      let score = 0;
      
      // +10 points per inspection-related field
      score += table.inspectionFields.length * 10;
      
      // +5 points per defect-related field
      score += table.defectFields.length * 5;
      
      // +1 point per column (up to 50)
      score += Math.min(table.columnCount, 50);
      
      // +1 point per 100 rows (up to 100)
      score += Math.min(Math.floor(table.rowCount / 100), 100);
      
      return {
        ...table,
        score,
      };
    });

    // Sort by score (highest first)
    scoredTables.sort((a, b) => (b.score || 0) - (a.score || 0));

    return NextResponse.json({
      success: true,
      tables: scoredTables,
      totalTables: tables.length,
      recommendedTable: scoredTables[0]?.name,
      candidateTables: scoredTables.slice(0, 3).map(t => t.name),
    });
  } catch (error) {
    // Clean up temp file if it exists
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch {}
    }

    console.error('MDB diagnose error:', error);
    return NextResponse.json(
      { 
        error: (error as Error).message || 'Failed to diagnose MDB file',
        suggestion: 'Make sure mdbtools is installed: brew install mdbtools (macOS) or sudo apt-get install mdbtools (Linux)',
      },
      { status: 500 }
    );
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch {}
    }
  }
}

