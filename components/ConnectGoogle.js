import Link from 'next/link';
export default function ConnectGoogle({ what = 'your calendar and email' }) {
  return (
    <div className="connect">
      <b>Connect Google to see {what}</b>
      <p>One-time setup, about 5 minutes.</p>
      <Link className="btn primary" href="/settings">Set up Google</Link>
    </div>
  );
}
