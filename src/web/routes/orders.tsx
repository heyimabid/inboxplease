import { useState } from 'react';
import { ArrowUpRight, ShoppingBag } from 'lucide-react';
import type { Order } from '../lib/types';
import type { orderItems } from '../../worker/db/schema';
import { useResource, mutate, formatMoney } from '../lib/api';
import { Badge, Empty, Loading, ErrorNotice, Modal, useToast } from '../components/ui';
export function OrdersPage() {
  const [selected, setSelected] = useState<string | null>(null),
    [page, setPage] = useState(0);
  const { data, error, loading, refresh } = useResource<Order[]>(`/api/orders?offset=${page * 40}`);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">FROM CONVERSATION TO CONFIRMATION</span>
          <h1>
            Orders<span className="heading-dot">.</span>
          </h1>
          <p>Confirmed by your customers. Ready for your next step.</p>
        </div>
        <ShoppingBag size={27} className="muted" />
      </div>
      <section className="section-card">
        <div className="section-toolbar">
          <h2>
            All orders <span className="count">{data?.length ?? 0}</span>
          </h2>
        </div>
        {error && <ErrorNotice message={error} />}{' '}
        {loading ? (
          <Loading />
        ) : data?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Delivery area</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <button className="text-button" onClick={() => setSelected(o.id)}>
                        {o.orderNumber}
                      </button>
                      <small>{new Date(o.createdAt).toLocaleDateString()}</small>
                    </td>
                    <td>
                      <strong>{o.customerName}</strong>
                      <small>{o.phone}</small>
                    </td>
                    <td>{o.deliveryArea}</td>
                    <td className="money">{formatMoney(o.total, o.currency)}</td>
                    <td>
                      <Badge
                        tone={
                          o.status === 'cancelled'
                            ? 'red'
                            : o.status === 'delivered'
                              ? 'green'
                              : 'amber'
                        }
                      >
                        {o.status}
                      </Badge>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`View order ${o.orderNumber}`}
                        onClick={() => setSelected(o.id)}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Your next order starts with a message"
            description="When a customer confirms their order summary, the order will appear here with its verified details."
          />
        )}
        <footer className="table-footer">
          <span>Order details are captured at confirmation.</span>
          <div>
            <button className="text-button" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button
              className="text-button"
              disabled={(data?.length ?? 0) < 40}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </footer>
      </section>
      {selected && (
        <OrderDetails id={selected} onClose={() => setSelected(null)} onSave={refresh} />
      )}
    </>
  );
}
function OrderDetails({
  id,
  onClose,
  onSave,
}: {
  id: string;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const { data, error, loading, refresh } = useResource<
    Order & { items: (typeof orderItems.$inferSelect)[] }
  >(`/api/orders/${id}`);
  const [status, setStatus] = useState<string | null>(null),
    toast = useToast();
  const allowed: Record<string, string[]> = {
    confirmed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
  };
  return (
    <Modal title={data?.orderNumber ?? 'Order details'} onClose={onClose}>
      {loading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNotice message={error || 'Order unavailable'} />
      ) : (
        <>
          <Badge tone="green">{data.status}</Badge>
          <div className="form-grid editor-section">
            <div>
              <small>Customer</small>
              <h3>{data.customerName}</h3>
              <p>{data.phone}</p>
            </div>
            <div>
              <small>Delivery</small>
              <p>
                {data.deliveryAddress}
                <br />
                {data.deliveryArea}
              </p>
            </div>
          </div>
          {data.items.map((i) => (
            <div className="variant-row" key={i.id}>
              <span>
                <strong>{i.productNameSnapshot}</strong>
                <small>
                  {i.variantNameSnapshot} · {i.skuSnapshot} · Qty {i.quantity}
                </small>
              </span>
              <strong>{formatMoney(i.lineTotal, data.currency)}</strong>
            </div>
          ))}
          <div className="draft-totals">
            <span>Subtotal</span>
            <strong>{formatMoney(data.subtotal, data.currency)}</strong>
            <span>Delivery</span>
            <strong>{formatMoney(data.deliveryFee, data.currency)}</strong>
            <span>Total</span>
            <strong>{formatMoney(data.total, data.currency)}</strong>
          </div>
          <a className="text-button" href={`/inbox?conversation=${data.conversationId}`}>
            Open customer conversation <ArrowUpRight size={14} />
          </a>
          <div className="modal-actions">
            {allowed[data.status]?.map((s) => (
              <button
                key={s}
                className={`button ${s === 'cancelled' ? 'danger-button' : 'primary'}`}
                onClick={() => setStatus(s)}
              >
                {s === 'cancelled' ? 'Cancel order' : `Mark ${s}`}
              </button>
            ))}
          </div>
          {status && (
            <Modal title={`Mark order ${status}?`} onClose={() => setStatus(null)}>
              <p>
                {status === 'cancelled'
                  ? 'This cancels the order and returns its stock to inventory.'
                  : 'Update the fulfillment status for this order.'}
              </p>
              <div className="modal-actions">
                <button className="button" onClick={() => setStatus(null)}>
                  Keep current status
                </button>
                <button
                  className="button primary"
                  onClick={() =>
                    void mutate(`/api/orders/${id}/status`, { status })
                      .then(refresh)
                      .then(onSave)
                      .then(() => setStatus(null))
                      .catch((e) => toast(String(e)))
                  }
                >
                  Confirm change
                </button>
              </div>
            </Modal>
          )}
        </>
      )}
    </Modal>
  );
}
