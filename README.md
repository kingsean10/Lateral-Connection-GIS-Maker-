# Sewer Lateral Inspection System

A Next.js web application that processes GeoJSON sewer asset files and NASSCO MDB inspection files to create lateral inspection layers with address matching using Mapbox geocoding.

## Features

- Upload GeoJSON files containing sewer asset information
- Upload NASSCO MDB inspection files (or JSON format)
- Automatically calculate lateral positions based on tap distance and clock position
- Reverse geocode lateral locations to match addresses using Mapbox
- Interactive map display with clickable lateral points
- Export lateral inspections as GeoJSON

## Prerequisites

- Node.js 18+ and npm/yarn
- Mapbox account and API token
- **For MDB file support**: `mdbtools` (optional, for direct MDB file parsing)
  - macOS: `brew install mdbtools`
  - Linux: `sudo apt-get install mdbtools`
  - If not installed, you can convert MDB to JSON format first

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
Create a `.env.local` file in the root directory:
```
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_public_token_here
MAPBOX_ACCESS_TOKEN=your_mapbox_access_token_here
```

You can get your Mapbox tokens from [Mapbox Account](https://account.mapbox.com/access-tokens/)

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Usage

1. **Upload GeoJSON File**: Upload a GeoJSON file containing sewer assets (points or lines)
2. **Upload Inspection Data**: Upload inspection data in MDB, ACCDB, or JSON format
   - **MDB/ACCDB files**: Direct upload supported if `mdbtools` is installed
     - macOS: `brew install mdbtools`
     - Linux: `sudo apt-get install mdbtools`
   - **JSON format**: If mdb-tools is not available, convert MDB to JSON first
   - The data should contain fields like:
     - `ASSET_ID` or `assetId`: Asset identifier
     - `TAP_DISTANCE` or `tapDistance`: Distance in meters
     - `CLOCK_POS` or `clockPosition`: Clock position (0-12)
     - `INSPECTION_DATE` or `inspectionDate`: Optional inspection date
3. **Process Data**: Click "Process Data" to calculate lateral positions and match addresses
4. **View Results**: Explore the map and lateral inspection list
5. **Export**: Download the results as a GeoJSON file

## MDB File Handling

The application now supports direct MDB/ACCDB file uploads using `mdb-tools`:

1. **Install mdbtools** (required for direct MDB parsing):
   - macOS: `brew install mdbtools`
   - Linux: `sudo apt-get install mdbtools`
   - Windows: Not directly supported, use JSON conversion instead

2. **Alternative**: If mdb-tools is not available, convert MDB to JSON:
   - Use `mdb-export` command: `mdb-export database.mdb table_name > output.json`
   - Or use Microsoft Access to export tables to JSON/CSV

The application will automatically detect and parse inspection tables from MDB files.

## Project Structure

```
/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   ├── upload/        # File upload endpoints
│   │   └── process/       # Data processing endpoint
│   ├── page.tsx           # Main page
│   └── layout.tsx         # Root layout
├── components/            # React components
│   ├── FileUpload.tsx     # File upload component
│   ├── MapView.tsx        # Mapbox map component
│   └── LateralInspectionList.tsx
├── lib/                   # Utility libraries
│   ├── parsers/           # File parsers
│   ├── services/          # External services (geocoding)
│   ├── utils/             # Utility functions
│   └── types/             # TypeScript types
└── public/                # Static files
```

## Clock Position Reference

Clock positions are converted to bearings:
- 12 = North (0°)
- 3 = East (90°)
- 6 = South (180°)
- 9 = West (270°)

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions on deploying to GitHub and Vercel.

### Quick Deploy to Vercel

1. Push your code to GitHub (see DEPLOYMENT.md)
2. Sign up at [vercel.com](https://vercel.com) with your GitHub account
3. Import your GitHub repository
4. Add environment variables in Vercel dashboard:
   - `NEXT_PUBLIC_MAPBOX_TOKEN` (your Mapbox public token)
5. Click Deploy!

Vercel will automatically deploy your app and provide a live URL.

## License

MIT

