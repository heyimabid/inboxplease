import { useState } from 'react';
import type { customers } from '../../worker/db/schema';
import { useResource, mutate } from '../lib/api';
import { Badge, Empty, Loading, ErrorNotice, Modal, useToast } from '../components/ui';
import { Trash2, Users } from 'lucide-react';
export function CustomersPage() {
  const [page, setPage] = useState(0),
    [remove, setRemove] = useState<string | null>(null),
    toast = useToast();
  const { data, error, loading, refresh } = useResource<(typeof customers.$inferSelect)[]>(
    `/api/customers?offset=${page * 40}`,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE PEOPLE BEHIND THE MESSAGES</span>
          <h1>
            Customers<span className="heading-dot">.</span>
          </h1>
          <p>A little context for a more personal conversation.</p>
        </div>
        <Users className="muted" size={25} />
      </div>
      <section className="section-card">
        <div className="section-toolbar">
          <h2>Your customers</h2>
        </div>
        {error && <ErrorNotice message={error} />}{' '}
        {loading ? (
          <Loading />
        ) : data?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th>Language</th>
                  <th>Since</th>
                  <th>
                    <span className="sr-only">Delete</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name ?? 'Messenger customer'}</strong>
                    </td>
                    <td>{c.phone ?? 'Not collected'}</td>
                    <td>{c.defaultAddress ?? 'Not collected'}</td>
                    <td>
                      <Badge>{c.languagePreference ?? 'Learning preference'}</Badge>
                    </td>
                    <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button
                        className="icon-button danger"
                        aria-label={`Delete ${c.name ?? 'customer'} data`}
                        onClick={() => setRemove(c.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Meet your next customer"
            description="Customer records are created when someone messages a connected Page."
          />
        )}
        <footer className="table-footer">
          <span>Customer details come from their conversations.</span>
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
      {remove && (
        <Modal title="Permanently delete customer data?" onClose={() => setRemove(null)}>
          <p>
            This deletes the customer’s conversations, messages, images, drafts, and orders from
            this workspace. This cannot be undone.
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setRemove(null)}>
              Keep customer
            </button>
            <button
              className="button danger-button"
              onClick={() =>
                void mutate(`/api/customers/${remove}`, undefined, 'DELETE')
                  .then(refresh)
                  .then(() => {
                    setRemove(null);
                    toast('Customer data deleted');
                  })
                  .catch((e) => toast(String(e)))
              }
            >
              Delete customer data
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
