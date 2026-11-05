'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from './AppProvider';
import { IconHome, IconList, IconCal, IconMail, IconGear } from './Icons';
import { todayStr } from '@/lib/dates';

export default function Sidebar() {
  const path = usePathname();
  const { tasks, status } = useApp();
  const today = todayStr();
  const dueNow = tasks.filter((t) => t.due_date && t.due_date <= today).length;
  const links = [
    { href: '/', label: 'Today', icon: IconHome, badge: dueNow || null },
    { href: '/tasks', label: 'Tasks', icon: IconList },
    { href: '/calendar', label: 'Calendar', icon: IconCal },
    { href: '/mail', label: 'Mail', icon: IconMail },
    { href: '/settings', label: 'Settings', icon: IconGear },
  ];
  return (
    <nav className="sidebar">
      <div className="brand"><div className="brand-mark">Me</div><span>Me</span></div>
      {links.map(({ href, label, icon: I, badge }) => (
        <Link key={href} href={href} className={`nav-link ${(href === '/' ? path === '/' : path.startsWith(href)) ? 'active' : ''}`}>
          <I /><span>{label}</span>{badge && <span className="badge">{badge}</span>}
        </Link>
      ))}
      <div className="spacer" />
      <div className="foot">
        {status?.google?.connected ? `● ${status.google.email || 'Google connected'}` : '○ Google not connected'}
      </div>
    </nav>
  );
}
