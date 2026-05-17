import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { onSidecarFailed, type SidecarFailedPayload } from './lib/rpc';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/chat', label: 'Chat' },
  { to: '/catalog', label: 'Catalog' },
  { to: '/vault', label: 'Vault' },
  { to: '/agent-runs', label: 'Agent Runs' },
  { to: '/secrets', label: 'Secrets' },
  { to: '/settings', label: 'Settings' },
] as const;

function PagePlaceholder({ title }: { title: string }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p className="muted">
        Stub. Phase 6f wires this view to the sidecar via <code>rpcCall</code>.
      </p>
    </section>
  );
}

function Layout() {
  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand">
          claude-os
        </Link>
        <nav>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading">
      <div className="spinner" />
      <p>claude-os startet …</p>
    </div>
  );
}

function SidecarFailedBanner({ payload }: { payload: SidecarFailedPayload }) {
  return (
    <div className="banner banner-error" role="alert">
      <strong>Sidecar nicht verfügbar</strong>
      <span>
        {payload.reason} (nach {payload.strikes} Versuchen). UI läuft im Read-Only-Modus.
      </span>
    </div>
  );
}

export function App() {
  const [showLoading, setShowLoading] = useState(true);
  const [failure, setFailure] = useState<SidecarFailedPayload | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setShowLoading(false), 500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onSidecarFailed((payload) => setFailure(payload)).then((u) => {
      unlisten = u;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  if (showLoading) return <LoadingScreen />;

  return (
    <Router>
      {failure && <SidecarFailedBanner payload={failure} />}
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<PagePlaceholder title="Dashboard" />} />
          <Route path="chat" element={<PagePlaceholder title="Chat" />} />
          <Route path="catalog" element={<PagePlaceholder title="Catalog" />} />
          <Route path="vault" element={<PagePlaceholder title="Vault" />} />
          <Route path="agent-runs" element={<PagePlaceholder title="Agent Runs" />} />
          <Route path="secrets" element={<PagePlaceholder title="Secrets" />} />
          <Route path="settings" element={<PagePlaceholder title="Settings" />} />
        </Route>
      </Routes>
    </Router>
  );
}
