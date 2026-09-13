import { apiUrl } from '../lib/api';
import { z } from 'zod';
import { useState, type FormEvent } from 'react';
import { Plus, Search, Package, ArrowUpRight, Upload, Trash2 } from 'lucide-react';
import { api, mutate, useResource, formatMoney } from '../lib/api';
import type { Product, ProductDetail, Variant } from '../lib/types';
import { useSession } from '../app';
import { Badge, Empty, ErrorNotice, Loading, Modal, useToast } from '../components/ui';
export function Products() {
  const [search, setSearch] = useState(''),
    [edit, setEdit] = useState<string | null>(null),
    [page, setPage] = useState(0);
  const { data, error, loading, refresh } = useResource<Product[]>(
    `/api/products?q=${encodeURIComponent(search)}&offset=${page * 40}`,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR STORE, AT A GLANCE</span>
          <h1>
            Products<span className="heading-dot">.</span>
          </h1>
          <p>The source of truth behind every conversation.</p>
        </div>
        <button className="button primary" onClick={() => setEdit('new')}>
          <Plus size={17} /> Add product
        </button>
      </div>
      <div className="section-card">
        <div className="section-toolbar">
          <h2>
            All products <span className="count">{data?.length ?? 0}</span>
          </h2>
          <label className="search">
            <Search size={17} />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Search name or SKU"
              aria-label="Search products"
            />
          </label>
        </div>
        {error && <ErrorNotice message={error} />}{' '}
        {loading ? (
          <Loading />
        ) : data?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU / Category</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>AI catalog</th>
                  <th>
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button className="product-name" onClick={() => setEdit(p.id)}>
                        <span className="product-symbol">
                          <Package size={21} />
                        </span>
                        <span>
                          <strong>{p.name}</strong>
                          <small>{p.description.slice(0, 65) || 'No description yet'}</small>
                        </span>
                      </button>
                    </td>
                    <td>
                      {p.sku || '—'}
                      <small>{p.category || 'Uncategorized'}</small>
                    </td>
                    <td className="money">{formatMoney(p.basePrice, p.currency)}</td>
                    <td>
                      <Badge tone={p.status === 'active' ? 'green' : 'neutral'}>{p.status}</Badge>
                    </td>
                    <td>
                      <span className={`index-state ${p.indexStatus}`}>
                        <span />
                        {p.indexStatus}
                      </span>
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Edit ${p.name}`}
                        onClick={() => setEdit(p.id)}
                      >
                        <ArrowUpRight size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Your catalog starts here"
            description="Add a product with its real price and stock. Your assistant will use these facts when customers ask."
            action={
              <button className="button primary" onClick={() => setEdit('new')}>
                <Plus size={16} /> Add your first product
              </button>
            }
          />
        )}
        <footer className="table-footer">
          <span>Prices and availability always come from your catalog.</span>
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
      </div>
      {edit && <ProductEditor id={edit} onClose={() => setEdit(null)} onSave={refresh} />}
    </>
  );
}
function ProductEditor({
  id,
  onClose,
  onSave,
}: {
  id: string;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const { data, loading, error, refresh } = useResource<ProductDetail>(
    id === 'new' ? null : `/api/products/${id}`,
  );
  const [savedId, setSavedId] = useState(id),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(''),
    [variant, setVariant] = useState<Variant | 'new' | null>(null),
    [archive, setArchive] = useState(false);
  const session = useSession(),
    toast = useToast();
  const currency = session.workspaces.find((w) => w.id === session.workspaceId)?.currency ?? 'BDT';
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const p = await mutate<ProductDetail>(
        savedId === 'new' ? '/api/products' : `/api/products/${savedId}`,
        {
          name: f.get('name'),
          sku: f.get('sku') || null,
          category: f.get('category') || null,
          description: f.get('description'),
          aliases: f.get('aliases'),
          basePrice: Math.round(Number(f.get('price')) * 100),
          compareAtPrice: null,
          currency,
          status: f.get('status'),
          isAiSearchable: f.get('searchable') === 'on',
        },
        savedId === 'new' ? 'POST' : 'PUT',
      );
      setSavedId(p.id);
      await onSave();
      if (id !== 'new') await refresh();
      toast('Product saved. Catalog indexing queued.');
      if (id === 'new') onClose();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={id === 'new' ? 'Add a product' : (data?.name ?? 'Edit product')}
      onClose={onClose}
    >
      {id !== 'new' && loading ? (
        <Loading />
      ) : error ? (
        <ErrorNotice message={error} />
      ) : (
        <>
          <form className="form-stack" onSubmit={(e) => void submit(e)}>
            <div className="form-grid">
              <label className="span-2">
                Product name
                <input
                  name="name"
                  defaultValue={data?.name}
                  required
                  minLength={2}
                  maxLength={180}
                />
              </label>
              <label>
                SKU
                <input name="sku" defaultValue={data?.sku ?? ''} />
              </label>
              <label>
                Category
                <input name="category" defaultValue={data?.category ?? ''} />
              </label>
              <label>
                Base price ({currency})
                <input
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={data ? data.basePrice / 100 : undefined}
                  required
                />
              </label>
              <label>
                Status
                <select name="status" defaultValue={data?.status ?? 'draft'}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <label className="span-2">
                Description
                <textarea name="description" rows={3} defaultValue={data?.description} />
              </label>
              <label className="span-2">
                Customer wording & Banglish aliases
                <input
                  name="aliases"
                  placeholder="hoodie, hudi, শীতের জামা"
                  defaultValue={data?.aliases}
                />
              </label>
              <label className="checkbox span-2">
                <input
                  type="checkbox"
                  name="searchable"
                  defaultChecked={data?.isAiSearchable ?? true}
                />{' '}
                Include in the AI catalog when active
              </label>
            </div>
            {failure && <ErrorNotice message={failure} />}
            <button className="button primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save product'}
            </button>
          </form>
          {data && (
            <>
              <div className="editor-section">
                <div className="inline-heading">
                  <h3>Variants & stock</h3>
                  <button className="button small" onClick={() => setVariant('new')}>
                    <Plus size={15} /> Add variant
                  </button>
                </div>
                {data.variants.length === 0 && (
                  <p className="muted">Add at least one variant to make this product orderable.</p>
                )}
                {data.variants.map((v) => (
                  <button key={v.id} className="variant-row" onClick={() => setVariant(v)}>
                    <span>
                      <strong>{v.title}</strong>
                      <small>{v.sku}</small>
                    </span>
                    <span>{formatMoney(v.priceOverride ?? data.basePrice, data.currency)}</span>
                    <Badge tone={v.stockOnHand - v.reservedStock > 0 ? 'green' : 'amber'}>
                      {v.stockOnHand - v.reservedStock} available
                    </Badge>
                  </button>
                ))}
              </div>
              <div className="editor-section">
                <h3>Product images</h3>
                <div className="image-grid">
                  {data.images.map((image) => (
                    <div key={image.id}>
                      <img
                        src={image.url.startsWith('/') ? apiUrl(image.url) : image.url}
                        alt={image.altText ?? data.name}
                      />
                      <button
                        className="icon-button"
                        aria-label="Remove image"
                        onClick={() =>
                          void mutate(
                            `/api/products/${data.id}/images/${image.id}`,
                            undefined,
                            'DELETE',
                          )
                            .then(refresh)
                            .catch((e) => toast(String(e)))
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  <label className="upload-tile">
                    <Upload size={23} />
                    <span>Upload image</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void api(`/api/products/${data.id}/images`, {
                            method: 'POST',
                            body: file,
                            headers: { 'Content-Type': file.type },
                          })
                            .then(refresh)
                            .catch((e) => toast(String(e)));
                      }}
                    />
                  </label>
                </div>
                <small className="muted">JPEG, PNG or WebP · up to 5 MB</small>
              </div>
              <div className="editor-section">
                <h3>Product FAQs</h3>
                {data.faqs.map((f) => (
                  <div className="faq-row" key={f.id}>
                    <div>
                      <strong>{f.question}</strong>
                      <p>{f.answer}</p>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Delete FAQ"
                      onClick={() =>
                        void mutate(`/api/settings/faqs/${f.id}`, undefined, 'DELETE').then(refresh)
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <form
                  className="form-stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget,
                      f = new FormData(form);
                    void mutate('/api/settings/faqs', {
                      productId: data.id,
                      question: f.get('question'),
                      answer: f.get('answer'),
                    })
                      .then(async () => {
                        form.reset();
                        await refresh();
                      })
                      .catch((e) => toast(String(e)));
                  }}
                >
                  <label>
                    Question
                    <input name="question" required />
                  </label>
                  <label>
                    Verified answer
                    <textarea name="answer" required />
                  </label>
                  <button className="button small">Add FAQ</button>
                </form>
              </div>
              <button className="text-button danger" onClick={() => setArchive(true)}>
                Archive product
              </button>
            </>
          )}
          {variant && data && (
            <VariantEditor
              product={data}
              variant={variant}
              onClose={() => setVariant(null)}
              onSave={refresh}
            />
          )}{' '}
          {archive && data && (
            <Modal title="Archive this product?" onClose={() => setArchive(false)}>
              <p>
                It will leave the active catalog and stop appearing in new product answers. Existing
                order snapshots are preserved.
              </p>
              <div className="modal-actions">
                <button className="button" onClick={() => setArchive(false)}>
                  Keep product
                </button>
                <button
                  className="button danger-button"
                  onClick={() =>
                    void mutate(`/api/products/${data.id}`, undefined, 'DELETE')
                      .then(onSave)
                      .then(onClose)
                  }
                >
                  Archive product
                </button>
              </div>
            </Modal>
          )}
        </>
      )}
    </Modal>
  );
}
function VariantEditor({
  product,
  variant,
  onClose,
  onSave,
}: {
  product: ProductDetail;
  variant: Variant | 'new';
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const v = variant === 'new' ? null : variant;
  const [error, setError] = useState('');
  return (
    <Modal title={v ? 'Edit variant' : 'Add variant'} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void mutate(
            `/api/products/${product.id}/variants${v ? `/${v.id}` : ''}`,
            {
              sku: f.get('sku'),
              title: f.get('title'),
              size: f.get('size') || null,
              color: f.get('color') || null,
              stockOnHand: Number(f.get('stock')),
              priceOverride: f.get('price') ? Math.round(Number(f.get('price')) * 100) : null,
              status: f.get('status'),
              attributes: {
                ...z.record(z.string(), z.string()).parse(JSON.parse(v?.attributesJson ?? '{}')),
                material: String(f.get('material') || ''),
              },
            },
            v ? 'PUT' : 'POST',
          )
            .then(onSave)
            .then(onClose)
            .catch((e) => setError(String(e)));
        }}
      >
        <div className="form-grid">
          <label>
            Title
            <input name="title" defaultValue={v?.title} required />
          </label>
          <label>
            Unique SKU
            <input name="sku" defaultValue={v?.sku} required />
          </label>
          <label>
            Color
            <input name="color" defaultValue={v?.color ?? ''} />
          </label>
          <label>
            Size
            <input name="size" defaultValue={v?.size ?? ''} />
          </label>
          <label>
            Stock on hand
            <input
              name="stock"
              type="number"
              min={v?.reservedStock ?? 0}
              defaultValue={v?.stockOnHand ?? 0}
              required
            />
          </label>
          <label>
            Price override
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              placeholder={`${product.basePrice / 100}`}
              defaultValue={v?.priceOverride != null ? v.priceOverride / 100 : ''}
            />
          </label>
          <label>
            Material
            <input
              name="material"
              defaultValue={
                v
                  ? String(
                      z.record(z.string(), z.string()).parse(JSON.parse(v.attributesJson))
                        .material ?? '',
                    )
                  : ''
              }
            />
          </label>
          <label>
            Status
            <select name="status" defaultValue={v?.status ?? 'active'}>
              <option>active</option>
              <option>inactive</option>
            </select>
          </label>
        </div>
        {error && <ErrorNotice message={error} />}
        <button className="button primary">Save variant</button>
      </form>
    </Modal>
  );
}
