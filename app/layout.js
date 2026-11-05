import './globals.css';
import AppProvider from '@/components/AppProvider';
import Sidebar from '@/components/Sidebar';

export const metadata = {
  title: 'Me',
  description: 'Personal dashboard',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};
export const viewport = { themeColor: '#d1492e' };

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
