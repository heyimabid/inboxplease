import { useResource, formatMoney } from '../lib/api';
import { useSession } from '../app';
import { Loading, ErrorNotice, Empty } from '../components/ui';
import { ShoppingBag, MessageSquare, Sparkles, UserRound } from 'lucide-react';
type Metrics = {
  revenue: number;
  orders: number;
  conversations: number;
  aiReplies: number;
  handoffs: number;
  activeProducts: number;
  daily: { date: string; count: number; total: number }[];
};
export function AnalyticsPage() {
  const { data, error, loading } = useResource<Metrics>('/api/analytics');
  const session = useSession(),
    currency = session.workspaces.find((w) => w.id === session.workspaceId)?.currency ?? 'BDT';
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNotice message={error || 'Analytics unavailable'} />;
  const max = Math.max(...data.daily.map((d) => d.count), 1);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE LAST 30 DAYS</span>
          <h1>
            Your store in numbers<span className="heading-dot">.</span>
          </h1>
          <p>See how your conversations turn into orders.</p>
        </div>
      </div>
      <div className="inbox-stats">
        {(
          [
            [ShoppingBag, formatMoney(data.revenue, currency), 'Confirmed order value'],
            [MessageSquare, data.conversations, 'New conversations'],
            [Sparkles, data.aiReplies, 'AI messages delivered'],
            [UserRound, data.handoffs, 'Human handoffs'],
          ] as const
        ).map(([Symbol, value, label]) => {
          return (
            <div key={String(label)}>
              <span className="stat-icon">
                <Symbol size={18} />
              </span>
              <span>
                <strong>{String(value)}</strong>
                <small>{String(label)}</small>
              </span>
            </div>
          );
        })}
      </div>
      <div className="settings-grid">
        <section className="section-card padded">
          <h2>Confirmed orders by day</h2>
          {data.daily.length ? (
            <div className="chart" role="img" aria-label="Daily confirmed order counts">
              {data.daily
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((day) => (
                  <div key={day.date} className="chart-row">
                    <small>{day.date}</small>
                    <span style={{ width: `${(day.count / max) * 65}%` }} />
                    <strong>{day.count}</strong>
                  </div>
                ))}
            </div>
          ) : (
            <Empty
              title="Room to grow"
              description="Your order activity will appear here after the first customer confirmation."
            />
          )}
        </section>
        <section className="section-card padded">
          <h2>Store activity</h2>
          <div className="setting-row">
            <span>Confirmed orders</span>
            <strong>{data.orders}</strong>
          </div>
          <div className="setting-row">
            <span>Active products</span>
            <strong>{data.activeProducts}</strong>
          </div>
          <div className="setting-row">
            <span>Orders per new conversation</span>
            <strong>
              {data.conversations
                ? ((data.orders / data.conversations) * 100).toFixed(1) + '%'
                : '—'}
            </strong>
          </div>
          <p className="muted">
            Order value excludes cancelled orders. Revenue here reflects confirmed order value, not
            collected payments. Daily boundaries use UTC.
          </p>
        </section>
      </div>
    </>
  );
}
