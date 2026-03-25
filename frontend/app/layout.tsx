import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Quadra Poker Club',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@300;400;500;700&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" type="image/x-icon" href="/flavicon/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/flavicon/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/flavicon/favicon-16x16.png" />
        <link rel="apple-touch-icon" sizes="180x180" href="/flavicon/apple-touch-icon.png" />
        <link rel="manifest" href="/flavicon/site.webmanifest" />
      </head>
      <body>{children}</body>
    </html>
  );
}
