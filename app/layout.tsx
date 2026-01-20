import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sewer Lateral Inspection System',
  description: 'Process GeoJSON sewer assets and NASSCO MDB inspection files to create lateral inspection layers',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

