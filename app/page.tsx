'use client';

import { useState } from 'react';
import FileUpload from '@/components/FileUpload';
import MapView from '@/components/MapView';
import LateralInspectionList from '@/components/LateralInspectionList';
import { SewerAsset, InspectionRecord, LateralInspection, DefectRecord, TapInspection } from '@/lib/types';
import { exportLateralsAsGeoJSON, validateGeoJSONExport, lateralsToGeoJSON, diagnoseGeoJSON } from '@/lib/utils/exportUtils';

export default function Home() {
  const [assets, setAssets] = useState<SewerAsset[]>([]);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [defects, setDefects] = useState<DefectRecord[]>([]);
  const [laterals, setLaterals] = useState<LateralInspection[]>([]);
  const [taps, setTaps] = useState<TapInspection[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedLateral, setSelectedLateral] = useState<LateralInspection | null>(null);
  const [selectedDefect, setSelectedDefect] = useState<DefectRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNameDialog, setShowNameDialog] = useState<boolean>(false);
  const [lateralLayerName, setLateralLayerName] = useState<string>('');
  const [pendingProcess, setPendingProcess] = useState<boolean>(false);
  const [processingStats, setProcessingStats] = useState<{
    assetsCount?: number;
    inspectionsCount?: number;
    lateralsCount?: number;
    defectsCount?: number;
    processedCount?: number;
    skippedCount?: number;
  } | null>(null);
  const [validationResults, setValidationResults] = useState<{
    isValid: boolean;
    errors: Array<{ featureId: string; error: string; coordinates: any }>;
    warnings: Array<{ featureId: string; warning: string; coordinates: any }>;
    statistics: {
      totalFeatures: number;
      pointFeatures: number;
      lineStringFeatures: number;
      coordinateRanges: {
        latitude: { min: number; max: number };
        longitude: { min: number; max: number };
      };
    };
  } | null>(null);

  const handleGeoJSONUpload = async (file: File) => {
    // Validate file before upload
    if (!file) {
      throw new Error('No file selected');
    }

    // Check file size
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum size is 50MB.`);
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload/geojson', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Upload failed: ${response.statusText}`);
      }

      const data = await response.json();
      setAssets(data.assets);
      setError(null);
      return data;
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('fetch')) {
        throw new Error('Network error. Please check your connection and try again.');
      }
      throw err;
    }
  };

  const handleMDBUpload = async (file: File) => {
    const formData = new FormData();
    
    if (file.name.toLowerCase().endsWith('.json')) {
      // If it's already JSON (converted from MDB)
      const text = await file.text();
      const jsonData = JSON.parse(text);
      formData.append('jsonData', JSON.stringify(jsonData));
    } else if (file.name.toLowerCase().endsWith('.mdb') || file.name.toLowerCase().endsWith('.accdb')) {
      // Direct MDB file upload
      formData.append('file', file);
    } else {
      throw new Error('File must be an MDB, ACCDB, or JSON file');
    }

    const response = await fetch('/api/upload/mdb', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || error.details || 'Failed to upload inspection data');
    }

    const data = await response.json();
    setInspections(data.inspections || []);
    setDefects(data.defects || []);
    
    if (data.inspections && data.inspections.length === 0) {
      let errorMsg = 'No inspections extracted from MDB file. ';
      if (data.inspectionColumns && data.inspectionColumns.length > 0) {
        errorMsg += `Found ${data.rawInspections?.length || 0} rows in PACP_Inspections table. `;
        errorMsg += `Table columns: ${data.inspectionColumns.slice(0, 10).join(', ')}${data.inspectionColumns.length > 10 ? '...' : ''}. `;
        if (data.fields) {
          errorMsg += `Detected fields: ${JSON.stringify(data.fields)}. `;
        }
        errorMsg += 'Check browser console for detailed field mapping.';
        console.error('MDB Debug Info:', {
          inspectionColumns: data.inspectionColumns,
          conditionColumns: data.conditionColumns,
          fields: data.fields,
          sampleInspection: data.sampleInspection,
          sampleCondition: data.sampleCondition,
        });
      } else {
        errorMsg += 'Check that the file contains PACP_Inspections and PACP_Conditions tables with proper column names.';
      }
      setError(errorMsg);
    } else {
      setError(null);
    }
    
    console.log('MDB upload result:', {
      count: data.count,
      defectCount: data.defectCount,
      inspectionsCount: data.inspections?.length || 0,
      defectsCount: data.defects?.length || 0,
      inspectionColumns: data.inspectionColumns?.slice(0, 10),
      fields: data.fields,
    });
    
    return data;
  };

  const handleProcess = async () => {
    if (assets.length === 0) {
      setError('Please upload a GeoJSON file first');
      return;
    }

    if (inspections.length === 0) {
      setError('No inspections found. Please check that your MDB file contains inspection data with Pipe Segment Reference, Tap Distance, and Clock Position fields. Check the browser console for more details.');
      return;
    }

    // If taps exist, show name dialog first
    if (taps.length > 0) {
      setShowNameDialog(true);
      setPendingProcess(true);
      return;
    }

    // Proceed with processing
    await executeProcess();
  };

  const executeProcess = async () => {
    setIsProcessing(true);
    setError(null);
    setProcessingStats(null);
    setShowNameDialog(false);
    setPendingProcess(false);

    try {
      // Set a longer timeout for processing (60 seconds)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assets,
          inspections,
          defects,
          taps: taps.length > 0 ? taps : undefined,
          lateralLayerName: taps.length > 0 && lateralLayerName ? lateralLayerName : undefined,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to process data');
      }

      const data = await response.json();
      setLaterals(data.data.laterals);
      setDefects(data.data.defects || []);
      setProcessingStats(data.stats || null);
      
      if (data.stats && data.stats.lateralsCount === 0) {
        setError('No laterals were created. Check that FID in your GeoJSON matches Pipe Segment Reference in the inspection data, and that inspections have valid tap distance and clock position values.');
      } else if (data.stats && data.stats.lateralsCount > 0) {
        // Clear any previous errors on success
        setError(null);
      }
      
      // Clear the layer name after successful processing
      setLateralLayerName('');
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Processing timed out. Try processing a smaller dataset or check your Mapbox API token.');
      } else {
        setError((err as Error).message);
      }
      setProcessingStats(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTapsChange = (newTaps: TapInspection[]) => {
    setTaps(newTaps);
  };

  const handleNameDialogConfirm = () => {
    if (!lateralLayerName.trim()) {
      setError('Please enter a name for the lateral layer');
      return;
    }
    executeProcess();
  };

  const handleNameDialogCancel = () => {
    setShowNameDialog(false);
    setPendingProcess(false);
    setLateralLayerName('');
  };

  const handleValidate = () => {
    if (laterals.length === 0) {
      setError('No lateral inspections to validate. Please process data first.');
      return;
    }
    try {
      const geojson = lateralsToGeoJSON(laterals);
      const validation = validateGeoJSONExport(geojson);
      setValidationResults(validation);
      
      if (validation.isValid) {
        setError(null);
        console.log('Validation passed:', validation.statistics);
      } else {
        const errorMsg = `Validation found ${validation.errors.length} error(s). Check details below.`;
        setError(errorMsg);
        console.error('Validation errors:', validation.errors);
      }
    } catch (err) {
      setError('Failed to validate GeoJSON: ' + (err as Error).message);
      setValidationResults(null);
    }
  };

  const handleExport = () => {
    if (laterals.length === 0) {
      setError('No lateral inspections to export. Please process data first.');
      return;
    }
    try {
      exportLateralsAsGeoJSON(laterals, 'lateral-inspections.geojson');
      // Show success message briefly
      const successMsg = `Exported ${laterals.length} lateral inspection${laterals.length !== 1 ? 's' : ''} to GeoJSON`;
      setError(null);
      // You could add a toast notification here if desired
      console.log(successMsg);
    } catch (err) {
      setError('Failed to export GeoJSON: ' + (err as Error).message);
    }
  };

  const handleLateralSelect = (lateral: LateralInspection) => {
    setSelectedLateral(lateral);
    setSelectedDefect(null);
  };
  
  const handleDefectSelect = (defect: DefectRecord) => {
    setSelectedDefect(defect);
    setSelectedLateral(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Sewer Lateral Inspection System
          </h1>
          <p className="text-gray-600">
            Upload GeoJSON sewer assets and NASSCO MDB inspection files to create lateral inspection layers
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Upload Section */}
          <div className="lg:col-span-1 space-y-4">
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-xl font-semibold mb-4">Upload Files</h2>
              
              <div className="space-y-4">
                <FileUpload
                  accept=".geojson,.json"
                  label="Sewer Assets (GeoJSON)"
                  onUpload={handleGeoJSONUpload}
                  onSuccess={(data) => {
                    console.log('GeoJSON uploaded:', data.count, 'assets');
                  }}
                  disabled={isProcessing}
                />

                <FileUpload
                  accept=".mdb,.accdb,.json"
                  label="Inspection Data (MDB/ACCDB/JSON)"
                  onUpload={handleMDBUpload}
                  onSuccess={(data) => {
                    console.log('Inspections uploaded:', data.count, 'inspections');
                  }}
                  disabled={isProcessing}
                />

                <button
                  onClick={handleProcess}
                  disabled={isProcessing || assets.length === 0}
                  className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {isProcessing ? 'Processing...' : 'Process Data'}
                </button>
                {assets.length > 0 && inspections.length === 0 && (
                  <p className="text-xs text-orange-600 mt-2">
                    Warning: No inspections found. Check browser console for details.
                  </p>
                )}

                {laterals.length > 0 && (
                  <>
                    <button
                      onClick={handleValidate}
                      className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors mb-2"
                    >
                      Validate Before Export
                    </button>
                    <button
                      onClick={handleExport}
                      className="w-full bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-colors"
                    >
                      Export GeoJSON ({laterals.length} laterals)
                    </button>
                  </>
                )}
              </div>

              {error && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm whitespace-pre-wrap">
                  {error}
                </div>
              )}

              {validationResults && (
                <div className={`mt-4 p-4 border rounded ${validationResults.isValid ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                  <h3 className={`font-semibold mb-2 ${validationResults.isValid ? 'text-green-800' : 'text-yellow-800'}`}>
                    Validation Results
                  </h3>
                  <div className="text-sm space-y-2">
                    <div>
                      <strong>Status:</strong> {validationResults.isValid ? '✓ Valid' : '✗ Invalid'}
                    </div>
                    <div>
                      <strong>Total Features:</strong> {validationResults.statistics.totalFeatures}
                      {' '}({validationResults.statistics.pointFeatures} Points, {validationResults.statistics.lineStringFeatures} LineStrings)
                    </div>
                    <div>
                      <strong>Coordinate Ranges:</strong>
                      <ul className="ml-4 mt-1">
                        <li>Latitude: {validationResults.statistics.coordinateRanges.latitude.min.toFixed(6)} to {validationResults.statistics.coordinateRanges.latitude.max.toFixed(6)}</li>
                        <li>Longitude: {validationResults.statistics.coordinateRanges.longitude.min.toFixed(6)} to {validationResults.statistics.coordinateRanges.longitude.max.toFixed(6)}</li>
                      </ul>
                    </div>
                    {validationResults.errors.length > 0 && (
                      <div className="mt-2">
                        <strong className="text-red-700">Errors ({validationResults.errors.length}):</strong>
                        <ul className="ml-4 mt-1 text-red-600 max-h-40 overflow-y-auto">
                          {validationResults.errors.slice(0, 5).map((err, idx) => (
                            <li key={idx} className="text-xs">
                              {err.featureId}: {err.error} - Coords: {JSON.stringify(err.coordinates)}
                            </li>
                          ))}
                          {validationResults.errors.length > 5 && (
                            <li className="text-xs italic">... and {validationResults.errors.length - 5} more (check console)</li>
                          )}
                        </ul>
                      </div>
                    )}
                    {validationResults.warnings.length > 0 && (
                      <div className="mt-2">
                        <strong className="text-yellow-700">Warnings ({validationResults.warnings.length}):</strong>
                        <ul className="ml-4 mt-1 text-yellow-600 max-h-40 overflow-y-auto">
                          {validationResults.warnings.slice(0, 3).map((warn, idx) => (
                            <li key={idx} className="text-xs">
                              {warn.featureId}: {warn.warning}
                            </li>
                          ))}
                          {validationResults.warnings.length > 3 && (
                            <li className="text-xs italic">... and {validationResults.warnings.length - 3} more (check console)</li>
                          )}
                        </ul>
                      </div>
                    )}
                    <div className="mt-2 text-xs text-gray-600">
                      💡 Tip: Open browser console (F12) for detailed diagnostic information. You can also call <code className="bg-gray-100 px-1 rounded">diagnoseGeoJSON(laterals)</code> in the console.
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-4 text-sm text-gray-600 space-y-1">
                <p>
                  <strong>Assets:</strong> {assets.length}
                </p>
                <p>
                  <strong>Inspections:</strong> {inspections.length}
                </p>
                <p>
                  <strong>Laterals:</strong> {laterals.length}
                </p>
                <p>
                  <strong>Defects:</strong> {defects.length}
                </p>
                {processingStats && (
                  <>
                    {processingStats.processedCount !== undefined && (
                      <p>
                        <strong>Processed:</strong> {processingStats.processedCount}
                      </p>
                    )}
                    {processingStats.defectsCount !== undefined && (
                      <p>
                        <strong>Defects Processed:</strong> {processingStats.defectsCount}
                      </p>
                    )}
                    {processingStats.skippedCount !== undefined && processingStats.skippedCount > 0 && (
                      <p className="text-orange-600">
                        <strong>Skipped:</strong> {processingStats.skippedCount}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Lateral List */}
            {laterals.length > 0 && (
              <div className="bg-white p-6 rounded-lg shadow">
                <h2 className="text-xl font-semibold mb-4">Lateral Inspections</h2>
                <LateralInspectionList
                  laterals={laterals}
                  onLateralSelect={handleLateralSelect}
                  selectedLateralId={selectedLateral?.id}
                />
              </div>
            )}
          </div>

          {/* Map Section */}
          <div className="lg:col-span-2">
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-xl font-semibold mb-4">Map View</h2>
              <div className="h-[600px] w-full">
                <MapView
                  assets={assets}
                  inspections={inspections}
                  laterals={laterals}
                  defects={defects}
                  onLateralClick={handleLateralSelect}
                  onDefectClick={handleDefectSelect}
                  onTapsChange={handleTapsChange}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-6">
          <h3 className="font-semibold text-blue-900 mb-2">Instructions</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Upload a GeoJSON file containing sewer assets with <strong>FID</strong> field</li>
            <li>Upload inspection data (MDB/ACCDB) with <strong>Pipe Segment Reference</strong> field</li>
            <li>Click "Process Data" to match FID to Pipe Segment Reference, calculate lateral positions, and geocode addresses</li>
            <li>View results on the interactive map - click lateral points to see details</li>
            <li>Export lateral inspections as GeoJSON file for use in other applications</li>
            <li>
              <strong>Matching:</strong> FID (GeoJSON) must match Pipe Segment Reference (MDB) for successful processing
            </li>
          </ul>
        </div>
      </div>

      {/* Name Input Dialog */}
      {showNameDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-xl font-semibold mb-4">Name Lateral Layer</h3>
            <p className="text-sm text-gray-600 mb-4">
              Enter a name for the lateral layer created from {taps.length} tap{taps.length !== 1 ? 's' : ''}.
            </p>
            <input
              type="text"
              value={lateralLayerName}
              onChange={(e) => setLateralLayerName(e.target.value)}
              placeholder="e.g., Tap Laterals 2024"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleNameDialogConfirm();
                } else if (e.key === 'Escape') {
                  handleNameDialogCancel();
                }
              }}
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleNameDialogCancel}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleNameDialogConfirm}
                disabled={!lateralLayerName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

