import { CustomerAvatar } from '../components/customer-avatar';
import { API_ORIGIN } from '../lib/api';
import { useState, useEffect, useRef } from 'react';
import {
  Search,
  ArrowUpRight,
  MessageSquare,
  Send,
  UserRound,
  CheckCheck,
  Plus,
  ShoppingBag,
  Sparkles,
} from 'lucide-react';
import type { Conversation, Message } from '../lib/types';
import type * as db from '../../worker/db/schema';
import { api, mutate, useResource, formatMoney } from '../lib/api';
import { useSession } from '../app';
import { Badge, Empty, ErrorNotice, Loading, Modal, useToast } from '../components/ui';
type Detail = {
  conversation: Conversation;
  customer: typeof db.customers.$inferSelect;
  page: { id: string; name: string };
  messages: Message[];
  handoff: typeof db.handoffs.$inferSelect | null;
  draft:
    (typeof db.orderDrafts.$inferSelect & { items: (typeof db.draftItems.$inferSelect)[] }) | null;
};
export function InboxPage() {
  const session = useSession(),
    toast = useToast();
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState(''),
    [selected, setSelected] = useState<string | null>(
      new URLSearchParams(location.search).get('conversation'),
    ),
    [simulate, setSimulate] = useState(false);
  const { data, error, loading, refresh } = useResource<Conversation[]>(
    `/api/conversations?q=${encodeURIComponent(query)}${filter ? `&mode=${filter}` : ''}`,
    3000,
  );
  const current = selected ?? data?.[0]?.id ?? null;
  const unread = data?.reduce((s, c) => s + c.unreadCount, 0) ?? 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">A GOOD DAY STARTS WITH A CONVERSATION</span>
          <h1>
            Your inbox<span className="heading-dot">.</span>
          </h1>
          <p>Be there for your customers. We’ll help with the rest.</p>
        </div>
        {session.mode === 'mock' && (
          <button className="button primary" onClick={() => setSimulate(true)}>
            <Plus size={16} />
            Try a conversation
          </button>
        )}
      </div>
      <div className="inbox-stats">
        <div>
          <span className="stat-icon">
            <MessageSquare size={18} />
          </span>
          <span>
            <strong>{data?.length ?? 0}</strong>
            <small>Conversations</small>
          </span>
        </div>
        <div>
          <span className="stat-icon">
            <Sparkles size={18} />
          </span>
          <span>
            <strong>{data?.filter((c) => c.mode === 'ai').length ?? 0}</strong>
            <small>With your assistant</small>
          </span>
        </div>
        <div>
          <span className="stat-icon warm">
            <UserRound size={18} />
          </span>
          <span>
            <strong>{data?.filter((c) => c.mode === 'human').length ?? 0}</strong>
            <small>Need your attention</small>
          </span>
        </div>
        <div>
          <span className="stat-icon">
            <CheckCheck size={18} />
          </span>
          <span>
            <strong>{unread}</strong>
            <small>Unread messages</small>
          </span>
        </div>
      </div>
      <div className="inbox-layout">
        <section className="conversation-list">
          <div className="conversation-list-head">
            <h2>
              Messages <span className="count">{data?.length ?? 0}</span>
            </h2>
            <label className="search">
              <Search size={15} />
              <input
                aria-label="Search conversations"
                placeholder="Search customers"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <div className="tabs">
              {[
                ['', 'All'],
                ['ai', 'AI active'],
                ['human', 'Needs you'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? 'active' : ''}
                  onClick={() => setFilter(value ?? '')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {error && <ErrorNotice message={error} />}{' '}
          {loading ? (
            <Loading />
          ) : data?.length ? (
            data.map((c) => (
              <button
                key={c.id}
                className={`conversation-row ${current === c.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelected(c.id);
                  void mutate(`/api/conversations/${c.id}/read`)
                    .then(refresh)
                    .catch((e) => toast(String(e)));
                }}
              >
                <CustomerAvatar name={c.customerName} picture={c.customerPicture} />
                <div>
                  <div className="conversation-row-title">
                    <strong>{c.customerName ?? 'Messenger customer'}</strong>
                    <small>
                      {new Date(c.lastMessageAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </div>
                  <p>{c.preview ?? 'Shared an attachment'}</p>
                  <div className="conversation-row-meta">
                    <Badge tone={c.mode === 'ai' ? 'green' : 'amber'}>
                      {c.mode === 'ai' ? 'AI active' : 'Needs you'}
                    </Badge>
                    {c.unreadCount > 0 && <span className="unread">{c.unreadCount}</span>}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <Empty title="A quiet inbox" description="New Page messages will appear here." />
          )}
          <div className="inbox-list-footer">
            <span className="status-dot" /> Checking for new conversations
          </div>
        </section>
        {current ? (
          <ConversationView key={current} id={current} refreshList={refresh} />
        ) : (
          <div className="conversation-main">
            <Empty
              title="Ready when your customers are"
              description="Connect a Page in Settings, add your catalog, and switch on automatic replies."
              action={
                <a href="/settings" className="button">
                  Set up your store <ArrowUpRight size={15} />
                </a>
              }
            />
          </div>
        )}
      </div>
      {simulate && <Simulation onClose={() => setSimulate(false)} />}
    </>
  );
}
function ConversationView({ id, refreshList }: { id: string; refreshList: () => Promise<void> }) {
  const { data, error, loading, refresh } = useResource<Detail>(`/api/conversations/${id}`, 2500);
  const [reply, setReply] = useState(''),
    [sending, setSending] = useState(false);
  const toast = useToast(),
    bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [data?.messages.length]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNotice message={error || 'Conversation unavailable'} />;
  const changeMode = async () => {
    await mutate(`/api/conversations/${id}/mode`, {
      mode: data.conversation.mode === 'ai' ? 'human' : 'ai',
    });
    await refresh();
    await refreshList();
  };
  return (
    <>
      <section className="conversation-main">
        <header className="conversation-header">
          <CustomerAvatar
            name={data.customer.facebookName ?? data.customer.name}
            picture={data.customer.profilePictureUrl}
          />
          <div>
            <h2>{data.customer.facebookName ?? data.customer.name ?? 'Messenger customer'}</h2>
            <small>Messenger Page-scoped ID: {data.customer.platformCustomerId}</small>
            <small>
              <span className="status-dot" /> {data.page.name} · Messenger
            </small>
          </div>
          <button
            className="button small"
            onClick={() => void changeMode().catch((e) => toast(String(e)))}
          >
            {data.conversation.mode === 'ai' ? <UserRound size={14} /> : <Sparkles size={14} />}{' '}
            {data.conversation.mode === 'ai' ? 'Take over' : 'Resume AI'}
          </button>
        </header>
        <div className={`conversation-mode ${data.conversation.mode}`}>
          <Sparkles size={14} />
          <span>
            {data.conversation.mode === 'ai'
              ? 'Your assistant is here. You can step in anytime.'
              : 'You’re in control. Automatic replies are paused.'}
          </span>
          <Badge tone={data.conversation.mode === 'ai' ? 'green' : 'amber'}>
            {data.conversation.mode === 'ai' ? 'AI active' : 'Human mode'}
          </Badge>
        </div>
        <div className="message-history">
          <div className="date-divider">
            {new Date(data.conversation.lastMessageAt).toLocaleDateString([], {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </div>
          {data.messages.map((m) => (
            <div key={m.id} className={`message ${m.direction}`}>
              <div className="message-body">
                {m.text && <p>{m.text}</p>}
                {m.attachmentJson && <Attachment raw={m.attachmentJson} />}
              </div>
              <small>
                {m.senderType === 'ai'
                  ? '✦ Assistant'
                  : m.senderType === 'human'
                    ? 'You'
                    : 'Customer'}{' '}
                ·{' '}
                {new Date(m.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {m.direction === 'outbound' && ` · ${m.deliveryStatus}`}
              </small>
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <form
          className="reply-box"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reply.trim()) return;
            setSending(true);
            void mutate(`/api/conversations/${id}/reply`, {
              text: reply,
              idempotencyKey: crypto.randomUUID(),
            })
              .then(async () => {
                setReply('');
                await refresh();
                await refreshList();
              })
              .catch((e) => toast(String(e)))
              .finally(() => setSending(false));
          }}
        >
          <label className="sr-only" htmlFor="reply">
            Reply to customer
          </label>
          <textarea
            id="reply"
            placeholder="Write a personal reply…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            maxLength={2000}
          />
          <div>
            <span>Sending a reply switches this conversation to human mode.</span>
            <button className="button primary small" disabled={sending || !reply.trim()}>
              <Send size={14} />
              {sending ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        </form>
      </section>
      <aside className="conversation-details">
        <div className="detail-heading">
          <ShoppingBag size={16} />
          <h3>Order details</h3>
        </div>
        {data.draft ? (
          <>
            <Badge tone={data.draft.state === 'CONFIRMED' ? 'green' : 'amber'}>
              {data.draft.state.replaceAll('_', ' ').toLowerCase()}
            </Badge>
            <div className="draft-field">
              <small>Customer</small>
              <strong>{data.draft.customerName ?? 'Not collected yet'}</strong>
            </div>
            <div className="draft-field">
              <small>Phone</small>
              <strong>{data.draft.phone ?? 'Not collected yet'}</strong>
            </div>
            <div className="draft-field">
              <small>Delivery address</small>
              <p>{data.draft.deliveryAddress ?? 'Not collected yet'}</p>
            </div>
            <div className="draft-field">
              <small>Delivery area</small>
              <p>{data.draft.deliveryArea ?? 'Not selected'}</p>
            </div>
            <div className="draft-totals">
              <span>Items ({data.draft.items.length})</span>
              <strong>
                {data.draft.subtotal != null
                  ? formatMoney(data.draft.subtotal, data.draft.currency)
                  : '—'}
              </strong>
              <span>Delivery</span>
              <strong>
                {data.draft.deliveryFee != null
                  ? formatMoney(data.draft.deliveryFee, data.draft.currency)
                  : '—'}
              </strong>
              <span>Total</span>
              <strong>
                {data.draft.total != null
                  ? formatMoney(data.draft.total, data.draft.currency)
                  : '—'}
              </strong>
            </div>
            <p className="draft-note">
              The customer must confirm the full summary before an order is placed.
            </p>
          </>
        ) : (
          <div className="draft-empty">
            <ShoppingBag size={34} />
            <strong>No order in progress</strong>
            <p>When your customer is ready, their order details will appear here.</p>
          </div>
        )}
        {data.handoff?.status === 'active' && (
          <div className="handoff-card">
            <h3>Handoff note</h3>
            <p>{data.handoff.reason.replaceAll('_', ' ')}</p>
            <details>
              <summary>Private conversation context</summary>
              <pre>{data.handoff.summary}</pre>
            </details>
          </div>
        )}
        <button
          className="text-button"
          onClick={() =>
            void mutate(`/api/conversations/${id}/status`, {
              status: data.conversation.status === 'resolved' ? 'open' : 'resolved',
            })
              .then(refresh)
              .then(refreshList)
          }
        >
          <CheckCheck size={16} />
          {data.conversation.status === 'resolved' ? 'Reopen conversation' : 'Mark as resolved'}
        </button>
      </aside>
    </>
  );
}
function Attachment({ raw }: { raw: string }) {
  let values: unknown;
  try {
    values = JSON.parse(raw);
  } catch {
    return <span>Attachment unavailable</span>;
  }
  if (!Array.isArray(values)) return null;
  return (
    <>
      {values.map((item: unknown, i) => {
        if (typeof item !== 'object' || item === null) return null;
        const url =
          'url' in item
            ? item.url
            : 'payload' in item &&
                typeof item.payload === 'object' &&
                item.payload !== null &&
                'url' in item.payload
              ? item.payload.url
              : undefined;
        return typeof url === 'string' &&
          (url.startsWith('/api/') ||
            url.startsWith('/media/') ||
            url.startsWith((API_ORIGIN || location.origin) + '/media/')) ? (
          <img key={i} src={url} alt="Shared product" />
        ) : (
          <span key={i} className="muted">
            Image attachment
          </span>
        );
      })}
    </>
  );
}
function Simulation({ onClose }: { onClose: () => void }) {
  const { data } =
    useResource<{ id: string; pageName: string; status: string }[]>('/api/facebook/pages');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal title="Try a customer conversation" onClose={onClose}>
      <p className="muted">
        This sends a local event through the real queue and conversation flow. Enable automatic
        replies in Settings to test the assistant.
      </p>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          const image = f.get('image');
          const request =
            image instanceof File && image.size
              ? api('/api/mock/image', {
                  method: 'POST',
                  body: image,
                  headers: {
                    'Content-Type': image.type,
                    'X-Page-ID': String(f.get('page')),
                    'X-Customer-ID': String(f.get('customer')),
                    'X-Image-Query': String(f.get('text') ?? ''),
                  },
                })
              : api('/api/mock/message', {
                  method: 'POST',
                  body: JSON.stringify({
                    pageId: f.get('page'),
                    customerId: f.get('customer'),
                    text: f.get('text'),
                  }),
                });
          void request
            .then(() => toast('Message queued. Watch your inbox.'))
            .catch((e) => toast(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Connected Page
          <select name="page" required>
            {data
              ?.filter((p) => p.status === 'active')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.pageName}
                </option>
              ))}
          </select>
        </label>
        <label>
          Local customer ID
          <input name="customer" defaultValue="customer-abid" required />
        </label>
        <label>
          Customer image (optional)
          <input type="file" name="image" accept="image/jpeg,image/png,image/webp" />
        </label>
        <label>
          Customer message
          <textarea name="text" defaultValue="black hoodie ta XL e ache?" required rows={3} />
        </label>
        <button
          className="button primary"
          disabled={busy || !data?.some((p) => p.status === 'active')}
        >
          <Send size={15} /> Send local message
        </button>
      </form>
    </Modal>
  );
}
