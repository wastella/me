import './globals.css';
import AppProvider, { OfflineBanner } from '@/components/AppProvider';
import { DialogProvider } from '@/components/ui';
import Sidebar from '@/components/Sidebar';

export const metadata = {
  title: 'Me',
  description: 'Personal dashboard',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
  // Full-screen when added to the iPhone home screen.
  appleWebApp: { capable: true, title: 'Me', statusBarStyle: 'black-translucent' },
};
export const viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#0c0c0d' }, { media: '(prefers-color-scheme: light)', color: '#f6f6f7' }],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <DialogProvider>
          <AppProvider>
            <div className="shell">
              <Sidebar />
              <main className="main"><OfflineBanner />{children}</main>
            </div>
          </AppProvider>
        </DialogProvider>
      </body>
    </html>
  );
}
