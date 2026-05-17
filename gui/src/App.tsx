import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import { onSidecarFailed, type SidecarFailedPayload } from './lib/rpc';
import {
  AgentRunsPage,
  CatalogPage,
  ChatPage,
  Dashboard,
  SecretsPage,
  SettingsPage,
  VaultPage,
} from './pages';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/chat', label: 'Chat' },
  { to: '/catalog', label: 'Catalog' },
  { to: '/vault', label: 'Vault' },
  { to: '/agent-runs', label: 'Agent Runs' },
  { to: '/secrets', label: 'Secrets' },
  { to: '/settings', label: 'Settings' },
] as const;

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
          <Route index element={<Dashboard />} />
          <Route path="chat" element={<ChatPage />} />
          <Route path="catalog" element={<CatalogPage />} />
          <Route path="vault" element={<VaultPage />} />
          <Route path="agent-runs" element={<AgentRunsPage />} />
          <Route path="secrets" element={<SecretsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </Router>
  );
}
