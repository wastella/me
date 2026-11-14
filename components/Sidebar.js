'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useApp } from './AppProvider';
import { IconHome, IconList, IconCal, IconLift, IconNote, IconGear } from './Icons';

// Sidebar on a computer, tab bar on a phone (where Settings moves to the
// gear at the top of Home, keeping the bar to five tabs).
const LINKS = [
  { href: '/', label: 'Home', icon: IconHome },
  { href: '/tasks', label: 'Tasks', icon: IconList },
  { href: '/calendar', label: 'Calendar', icon: IconCal },
  { href: '/notes', label: 'Notes', icon: IconNote },
  { href: '/training', label: 'Training', icon: IconLift },
  { href: '/settings', label: 'Settings', icon: IconGear, deskOnly: true },
];

export default function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const { status } = useApp();
  // The desktop app's menu (⌘1–5, ⌘,) navigates by sending this event.
  useEffect(() => {
    const go = (e) => router.push(e.detail);
    window.addEventListener('me:navigate', go);
    return () => window.removeEventListener('me:navigate', go);
  }, [router]);
  if (path === '/login') return null;
  const g = status?.google;
  return (
    <nav className="sidebar" aria-label="Main">
      <div className="brand"><div className="brand-mark">Me</div><span>Me</span></div>
      {LINKS.map(({ href, label, icon: I, deskOnly }) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        return (
          <Link key={href} href={href} className={`nav-link ${active ? 'active' : ''} ${deskOnly ? 'desk' : ''}`} aria-current={active ? 'page' : undefined}>
            <I /><span>{label}</span>
          </Link>
        );
      })}
      <div className="spacer" />
      {status && <div className="foot"><i className={`dot ${g?.connected ? 'on' : ''}`} /><span>{g?.connected ? g.email || 'Google connected' : 'Google not connected'}</span></div>}
    </nav>
  );
}
