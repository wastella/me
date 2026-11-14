import Link from 'next/link';
export default function ConnectGoogle({ what = 'your calendar' }) {
  return (
    <div className="connect">
      <b>Connect Google to see {what}</b>
      <p>A one-time setup that takes about five minutes.</p>
      <Link className="btn primary" href="/settings">Set up Google</Link>
    </div>
  );
}
