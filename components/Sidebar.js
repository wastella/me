'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useApp } from './AppProvider';
import { IconHome, IconList, IconCal, IconLift, IconNote, IconGear } from './Icons';

export default function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  // The desktop app's menu (⌘1–5, ⌘,) navigates by sending this event.
  useEffect(() => {
    const go = (e) => router.push(e.detail);
    window.addEventListener('me:navigate', go);
    return () => window.removeEventListener('me:navigate', go);
  }, [router]);
  const { status } = useApp();
  const links = [
    { href: '/', label: 'Home', icon: IconHome },
    { href: '/tasks', label: 'Tasks', icon: IconList },
    { href: '/calendar', label: 'Calendar', icon: IconCal },
    { href: '/notes', label: 'Notes', icon: IconNote },
    { href: '/training', label: 'Training', icon: IconLift },
    { href: '/settings', label: 'Settings', icon: IconGear },
  ];
  return (
    <nav className="sidebar">
      <div className="brand"><div className="brand-mark">Me</div><span>Me</span></div>
      {links.map(({ href, label, icon: I }) => (
        <Link key={href} href={href} className={`nav-link ${(href === '/' ? path === '/' : path.startsWith(href)) ? 'active' : ''}`}>
          <I /><span>{label}</span>
        </Link>
      ))}
      <div className="spacer" />
      <div className="foot">
        {status?.google?.connected ? `● ${status.google.email || 'Google connected'}` : '○ Google not connected'}
      </div>
    </nav>
  );
}
