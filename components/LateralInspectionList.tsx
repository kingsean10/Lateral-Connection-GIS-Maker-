'use client';

import { LateralInspection } from '@/lib/types';

interface LateralInspectionListProps {
  laterals: LateralInspection[];
  onLateralSelect?: (lateral: LateralInspection) => void;
  selectedLateralId?: string;
}

export default function LateralInspectionList({
  laterals,
  onLateralSelect,
  selectedLateralId,
}: LateralInspectionListProps) {
  if (laterals.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        No lateral inspections found. Upload and process files to see results.
      </div>
    );
  }

  return (
    <div className="overflow-y-auto max-h-96">
      <div className="space-y-2">
        {laterals.map((lateral) => (
          <div
            key={lateral.id}
            className={`
              p-3 border rounded-lg cursor-pointer transition-colors
              ${
                selectedLateralId === lateral.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }
            `}
            onClick={() => onLateralSelect?.(lateral)}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {lateral.address || 'Address not found'}
                </p>
                <div className="mt-1 space-y-1">
                  <p className="text-xs text-gray-600">
                    Distance: {lateral.tapDistance.toFixed(2)}m | Clock: {lateral.clockPosition}
                  </p>
                  {lateral.assetId && (
                    <p className="text-xs text-gray-500">Asset: {lateral.assetId}</p>
                  )}
                  {lateral.inspectionDate && (
                    <p className="text-xs text-gray-500">
                      Date: {new Date(lateral.inspectionDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
              <div className="ml-2 flex-shrink-0">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

