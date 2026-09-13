import { ConnectedPages } from '../components/pages';
import { useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import type { Settings } from '../lib/types';
import { mutate, useResource, formatMoney } from '../lib/api';
import { useSession } from '../app';
import { ErrorNotice, Loading, Modal, useToast } from '../components/ui';
export function SettingsPage() {
  const { data, error, loading, refresh } = useResource<Settings>('/api/settings');
  const [zone, setZone] = useState<Settings['delivery'][number] | true | null>(null),
    [faq, setFaq] = useState<Settings['policies'][number] | true | null>(null);
  const toast = useToast(),
    session = useSession();
  const currency = session.workspaces.find((w) => w.id === session.workspaceId)?.currency ?? 'BDT';
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNotice message={error || 'Settings unavailable'} />;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>
            Store settings<span className="heading-dot">.</span>
          </h1>
          <p>Set the details your assistant needs to get things right.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="section-card padded">
          <h2>AI assistant</h2>
          <p className="muted">
            Replies follow your catalog, policies, and the customer’s writing style.
          </p>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void Promise.resolve()
                .then(() =>
                  mutate(
                    '/api/settings',
                    {
                      autoReply: f.get('autoReply') === 'on',
                      tone: f.get('tone'),
                      responseStyle: f.get('responseStyle'),
                      handoffRules: f.get('handoffRules'),
                      retentionDays: Number(f.get('retention')),
                      temporaryImageHours: Number(f.get('temporary')),
                      normalization: JSON.parse(String(f.get('normalization') || '{}')),
                    },
                    'PUT',
                  ),
                )
                .then(async () => {
                  toast('Assistant settings saved');
                  await refresh();
                })
                .catch((e) => toast(String(e)));
            }}
          >
            <label className="toggle-row">
              <span>
                <strong>Automatic replies</strong>
                <small>Enable after reviewing your catalog and policies.</small>
              </span>
              <input type="checkbox" name="autoReply" defaultChecked={data.config.autoReply} />
            </label>
            <div className="form-grid">
              <label>
                Tone
                <select name="tone" defaultValue={data.config.tone}>
                  <option>friendly</option>
                  <option>concise</option>
                  <option>warm</option>
                </select>
              </label>
              <label>
                Response style
                <select name="responseStyle" defaultValue={data.config.responseStyle}>
                  <option value="match_customer">Match the customer</option>
                  <option value="english">English</option>
                  <option value="bangla">বাংলা</option>
                  <option value="banglish">Banglish</option>
                  <option value="mixed">Mixed</option>
                </select>
              </label>
            </div>
            <label>
              When to involve a human
              <textarea name="handoffRules" defaultValue={data.config.handoffRules} />
            </label>
            <div className="form-grid">
              <label>
                Conversation retention (days)
                <input
                  name="retention"
                  type="number"
                  min="1"
                  max="365"
                  defaultValue={data.config.retentionDays}
                />
              </label>
              <label>
                Customer image retention (hours)
                <input
                  name="temporary"
                  type="number"
                  min="1"
                  max="168"
                  defaultValue={data.config.temporaryImageHours}
                />
              </label>
            </div>
            <label>
              Custom wording dictionary (JSON)
              <textarea
                name="normalization"
                defaultValue={data.config.normalizationJson}
                rows={2}
              />
            </label>
            <button className="button primary">
              <Save size={16} /> Save settings
            </button>
          </form>
        </section>
        <div className="form-stack">
          <section className="section-card padded">
            <div className="inline-heading">
              <h2>Delivery zones</h2>
              <button
                className="icon-button"
                aria-label="Add delivery zone"
                onClick={() => setZone(true)}
              >
                <Plus size={20} />
              </button>
            </div>
            <p className="muted">Only these verified fees appear in order summaries.</p>
            {data.delivery.map((d) => (
              <div className="setting-row" key={d.id}>
                <span>
                  <strong>{d.name}</strong>
                  <small>
                    {d.estimatedDays ?? 'No delivery estimate'} ·{' '}
                    {d.isActive ? 'Active' : 'Inactive'}
                  </small>
                </span>
                <strong>{formatMoney(d.fee, d.currency)}</strong>
                <button className="text-button" onClick={() => setZone(d)}>
                  Edit
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    void mutate(
                      `/api/settings/delivery/${d.id}`,
                      {
                        name: d.name,
                        fee: d.fee,
                        currency: d.currency,
                        estimatedDays: d.estimatedDays,
                        isActive: !d.isActive,
                      },
                      'PUT',
                    )
                      .then(refresh)
                      .catch((e) => toast(String(e)))
                  }
                >
                  {d.isActive ? 'Disable' : 'Enable'}
                </button>
              </div>
            ))}
            {data.delivery.length === 0 && (
              <p className="muted">Add a delivery zone before accepting orders.</p>
            )}
            <button className="text-button" onClick={() => setZone(true)}>
              + Add delivery zone
            </button>
          </section>
          <section className="section-card padded">
            <div className="inline-heading">
              <h2>Store policies & FAQs</h2>
              <button className="icon-button" aria-label="Add policy" onClick={() => setFaq(true)}>
                <Plus size={20} />
              </button>
            </div>
            {data.policies
              .filter((f) => !f.productId)
              .map((f) => (
                <div className="faq-row" key={f.id}>
                  <div>
                    <button className="text-button" onClick={() => setFaq(f)}>
                      Edit
                    </button>
                    <strong>{f.question}</strong>
                    <p>{f.answer}</p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Remove policy"
                    onClick={() =>
                      void mutate(`/api/settings/faqs/${f.id}`, undefined, 'DELETE')
                        .then(refresh)
                        .catch((e) => toast(String(e)))
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            <button className="text-button" onClick={() => setFaq(true)}>
              + Add a store policy
            </button>
          </section>
          <ConnectedPages />
        </div>
      </div>
      {zone && (
        <Modal
          title={zone === true ? 'Add delivery zone' : 'Edit delivery zone'}
          onClose={() => setZone(null)}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate(
                zone === true ? '/api/settings/delivery' : `/api/settings/delivery/${zone.id}`,
                {
                  name: f.get('name'),
                  fee: Math.round(Number(f.get('fee')) * 100),
                  currency,
                  estimatedDays: f.get('days') || null,
                  isActive: zone === true ? true : zone.isActive,
                },
                zone === true ? 'POST' : 'PUT',
              )
                .then(refresh)
                .then(() => setZone(null))
                .catch((e) => toast(String(e)));
            }}
          >
            <label>
              Zone name
              <input
                name="name"
                placeholder="Dhakar vitore"
                defaultValue={zone === true ? undefined : zone.name}
                required
              />
            </label>
            <label>
              Delivery fee ({currency})
              <input
                name="fee"
                defaultValue={zone === true ? undefined : zone.fee / 100}
                type="number"
                step="0.01"
                min="0"
                required
              />
            </label>
            <label>
              Delivery estimate (optional)
              <input
                name="days"
                defaultValue={zone === true ? undefined : (zone.estimatedDays ?? '')}
                placeholder="Seller-confirmed estimate"
              />
            </label>
            <button className="button primary">Save delivery zone</button>
          </form>
        </Modal>
      )}
      {faq && (
        <Modal
          title={faq === true ? 'Add store policy' : 'Edit store policy'}
          onClose={() => setFaq(null)}
        >
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate(
                faq === true ? '/api/settings/faqs' : `/api/settings/faqs/${faq.id}`,
                {
                  question: f.get('question'),
                  answer: f.get('answer'),
                },
                faq === true ? 'POST' : 'PUT',
              )
                .then(refresh)
                .then(() => setFaq(null))
                .catch((e) => toast(String(e)));
            }}
          >
            <label>
              Customer question
              <input
                name="question"
                defaultValue={faq === true ? undefined : faq.question}
                placeholder="Can I pay cash on delivery?"
                required
              />
            </label>
            <label>
              Your store’s answer
              <textarea
                name="answer"
                defaultValue={faq === true ? undefined : faq.answer}
                required
              />
            </label>
            <button className="button primary">Save policy</button>
          </form>
        </Modal>
      )}
    </>
  );
}
