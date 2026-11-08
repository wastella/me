import './globals.css';
import AppProvider from '@/components/AppProvider';
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
  themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#0c0c0c' }, { media: '(prefers-color-scheme: light)', color: '#fafafa' }],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <div className="shell">
            <Sidebar />
            <main className="main">{children}</main>
          </div>
        </AppProvider>
      </body>
    </html>
  );
}
