import { CustomersPage } from './routes/customers';
import { AnalyticsPage } from './routes/analytics';
import { OrdersPage } from './routes/orders';
import { InboxPage } from './routes/inbox';
import { useState, createContext, useContext, type FormEvent } from 'react';
import { BrowserRouter, NavLink, Routes, Route, Navigate } from 'react-router-dom';
import {
  Inbox,
  Package,
  ShoppingBag,
  Users,
  Settings,
  BarChart3,
  ArrowUpRight,
  LogOut,
  Plus,
  ChevronDown,
  PanelLeftClose,
  MessageCircle,
} from 'lucide-react';
import { api, apiFetch, mutate, useResource } from './lib/api';
import type { Session } from './lib/types';
import {
  ErrorBoundary,
  ToastProvider,
  ErrorNotice,
  Loading,
  useToast,
  Modal,
} from './components/ui';
import { Products } from './routes/products';
import { SettingsPage } from './routes/settings';
const SessionContext = createContext<Session | null>(null);
export const useSession = () => useContext(SessionContext)!;
function Login({ refresh }: { refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const { data: health } = useResource<{ mode: string }>('/api/health');
  const mockLogin = async () => {
    setBusy(true);
    try {
      await mutate('/auth/mock');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };
  const facebookLogin = async () => {
    setBusy(true);
    try {
      const csrfResponse = await apiFetch('/authjs/csrf');
      if (!csrfResponse.ok) throw new Error('Facebook seller sign-in is not configured');
      const value: unknown = await csrfResponse.json();
      if (
        !value ||
        typeof value !== 'object' ||
        !('csrfToken' in value) ||
        typeof value.csrfToken !== 'string'
      )
        throw new Error('Could not start sign-in');
      const response = await apiFetch('/authjs/signin/facebook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Auth-Return-Redirect': '1',
        },
        body: new URLSearchParams({
          csrfToken: value.csrfToken,
          callbackUrl: `${location.origin}/`,
        }),
      });
      const result: unknown = await response.json();
      if (
        !response.ok ||
        !result ||
        typeof result !== 'object' ||
        !('url' in result) ||
        typeof result.url !== 'string'
      )
        throw new Error('Could not start sign-in');
      location.assign(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in');
      setBusy(false);
    }
  };
  return (
    <div className="auth-layout">
      <div className="auth-story">
        <div className="brand">
          <span className="brand-icon">
            <MessageCircle size={23} />
          </span>
          inboxplease<span className="brand-dot">.</span>
        </div>
        <div>
          <span className="eyebrow">LESS TYPING. MORE SELLING.</span>
          <h1>
            A little help.
            <br />
            For every
            <br />
            <em>“price koto?”</em>
          </h1>
          <p>
            Turn customer conversations into confident orders.
            <br />
            Your catalog. Your voice. Your store.
          </p>
        </div>
        <span className="story-footer">Made for the way you sell.</span>
      </div>
      <main className="auth-form">
        <div>
          <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
          <h2>
            Good conversations.
            <br />
            Better business.
          </h2>
          <p>
            Sign in to your seller workspace. You can connect a Facebook Page separately in
            Settings.
          </p>
          {error && <ErrorNotice message={error} />}
          <button
            className="button primary wide"
            disabled={busy}
            onClick={() => void facebookLogin()}
          >
            Continue with Facebook <ArrowUpRight size={18} />
          </button>
          {health?.mode === 'mock' && (
            <button
              className="button secondary wide"
              disabled={busy}
              onClick={() => void mockLogin()}
            >
              {busy ? 'Opening workspace…' : 'Explore local workspace'}
            </button>
          )}
          <small>Sign-in uses your public profile only. Page access is a separate choice.</small>
        </div>
      </main>
    </div>
  );
}
function CreateWorkspace({
  onCreated,
  onClose,
}: {
  onCreated: () => Promise<void>;
  onClose?: () => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      await mutate('/api/workspaces', {
        name: form.get('name'),
        currency: form.get('currency'),
        timezone: 'Asia/Dhaka',
      });
      await onCreated();
      onClose?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create store');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="form-stack">
      <p>Give your store a home. You can connect your Pages and add products next.</p>
      <label>
        Store name
        <input
          name="name"
          placeholder="Your store name"
          minLength={2}
          maxLength={100}
          required
          autoFocus
        />
      </label>
      <label>
        Store currency
        <select name="currency">
          <option value="BDT">Bangladeshi taka (BDT)</option>
          <option value="USD">US dollar (USD)</option>
          <option value="INR">Indian rupee (INR)</option>
        </select>
      </label>
      {error && <ErrorNotice message={error} />}
      <button className="button primary" disabled={busy}>
        {busy ? 'Creating…' : 'Create workspace'}
        <ArrowUpRight size={16} />
      </button>
    </form>
  );
}
function Shell({ session, refresh }: { session: Session; refresh: () => Promise<void> }) {
  const [create, setCreate] = useState(false),
    [navOpen, setNavOpen] = useState(false);
  const toast = useToast();
  const store = session.workspaces.find((w) => w.id === session.workspaceId);
  const nav = [
    ['/inbox', 'Inbox', Inbox],
    ['/products', 'Products', Package],
    ['/orders', 'Orders', ShoppingBag],
    ['/customers', 'Customers', Users],
    ['/analytics', 'Analytics', BarChart3],
    ['/settings', 'Settings', Settings],
  ] as const;
  return (
    <SessionContext.Provider value={session}>
      <div className="dashboard">
        <aside className={`sidebar ${navOpen ? 'mobile-open' : ''}`}>
          <NavLink to="/inbox" className="brand">
            <span className="brand-icon">
              <MessageCircle size={20} />
            </span>
            inboxplease<span className="brand-dot">.</span>
          </NavLink>
          <div className="workspace-picker">
            <span className="store-avatar">{store?.name[0]?.toUpperCase()}</span>
            <label className="sr-only" htmlFor="workspace">
              Workspace
            </label>
            <select
              id="workspace"
              value={session.workspaceId ?? ''}
              onChange={(e) =>
                void mutate(`/api/workspaces/${e.target.value}/select`)
                  .then(refresh)
                  .catch((e) => toast(String(e)))
              }
            >
              {session.workspaces.map((w) => (
                <option value={w.id} key={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
          <button className="text-button new-store" onClick={() => setCreate(true)}>
            <Plus size={13} />
            New workspace
          </button>
          <span className="nav-label">WORKSPACE</span>
          <nav>
            {nav.map(([to, label, Icon]) => (
              <NavLink key={to} to={to} onClick={() => setNavOpen(false)}>
                <Icon size={19} />
                {label}
                {label === 'Inbox' && <span className="nav-dot" />}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="quiet-card">
              <span className="status-dot" />
              <strong>{session.mode === 'mock' ? 'Local workspace' : 'Connected workspace'}</strong>
              <p>
                {session.mode === 'mock'
                  ? 'Try a conversation in the inbox. No live messages are sent.'
                  : 'Your catalog powers every reply.'}
              </p>
            </div>
            <div className="profile">
              <span className="avatar">{session.user.name[0]}</span>
              <div>
                <strong>{session.user.name}</strong>
                <small>{store?.role ?? 'Seller'}</small>
              </div>
              <button
                className="icon-button"
                title="Sign out"
                aria-label="Sign out"
                onClick={() => void mutate('/auth/logout').then(refresh)}
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div>
              <button
                className="icon-button mobile-toggle"
                aria-label="Toggle navigation"
                onClick={() => setNavOpen(!navOpen)}
              >
                <PanelLeftClose size={20} />
              </button>
              <span className="breadcrumb">
                Workspace <span>/</span> <strong>{store?.name}</strong>
              </span>
            </div>
            <span className="topbar-note">
              <span className="status-dot" />{' '}
              {session.mode === 'mock' ? 'Local development' : 'Seller workspace'}
            </span>
          </header>
          <main className="page-content">
            <Routes>
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/products/*" element={<Products />} />
              <Route path="/settings/*" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/inbox" replace />} />
            </Routes>
          </main>
        </div>
      </div>
      {create && (
        <Modal title="Create a workspace" onClose={() => setCreate(false)}>
          <CreateWorkspace onCreated={refresh} onClose={() => setCreate(false)} />
        </Modal>
      )}
    </SessionContext.Provider>
  );
}
function AppRoot() {
  const { data, error, loading, refresh } = useResource<Session | null>('/auth/session');
  if (loading) return <Loading />;
  if (error)
    return (
      <main className="auth-card">
        <ErrorNotice message={error} />
        <button className="button" onClick={() => void refresh()}>
          Try again
        </button>
      </main>
    );
  if (!data) return <Login refresh={refresh} />;
  if (!data.workspaceId)
    return (
      <main className="auth-card">
        <div className="brand">inboxplease.</div>
        <h1>Let’s meet your store.</h1>
        <CreateWorkspace onCreated={refresh} />
        <button
          className="text-button"
          onClick={() => void api('/auth/logout', { method: 'POST' }).then(refresh)}
        >
          Sign out
        </button>
      </main>
    );
  return <Shell key={data.workspaceId} session={data} refresh={refresh} />;
}
export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <AppRoot />
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
