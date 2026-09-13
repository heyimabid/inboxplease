import { useEffect, useState } from 'react';
import { Link2, Plus, CheckCircle2 } from 'lucide-react';
import { useResource, mutate, api } from '../lib/api';
import { Badge, Modal, useToast, ErrorNotice } from './ui';
type Candidate = { id: string; pageId: string; name: string };
export function ConnectedPages() {
  const { data, refresh, error } = useResource<
    {
      id: string;
      pageName: string;
      status: string;
      aiEnabled: boolean;
      ready: boolean;
      platformAiEnabled: boolean;
      platformMessagingEnabled: boolean;
    }[]
  >('/api/facebook/pages');
  const [available, setAvailable] = useState<Candidate[] | null>(null),
    [disconnect, setDisconnect] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (new URLSearchParams(location.search).get('facebook') === 'choose') {
      void api<Candidate[]>('/api/facebook/pages/available')
        .then(setAvailable)
        .catch((e) => toast(String(e)));
      history.replaceState(null, '', '/settings');
    }
    if (new URLSearchParams(location.search).get('facebook') === 'denied') {
      toast('Page permission was cancelled. Your seller sign-in is unchanged.');
      history.replaceState(null, '', '/settings');
    }
  }, [toast]);
  const connect = async () => {
    setBusy(true);
    try {
      const result = await mutate<{ url: string | null }>('/facebook/connect');
      if (result.url) location.assign(result.url);
      else setAvailable(await api<Candidate[]>('/api/facebook/pages/available'));
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="section-card padded">
      <div className="inline-heading">
        <h2>Facebook Pages</h2>
        <Link2 size={18} />
      </div>
      <p className="muted">Connect a Page, then choose when its assistant starts replying.</p>
      {error && <ErrorNotice message={error} />}
      {data?.map((p) => (
        <div className="setting-row" key={p.id}>
          <span>
            <strong>{p.pageName}</strong>
            <small>
              <Badge tone={p.status === 'active' ? 'green' : 'amber'}>{p.status}</Badge> · AI{' '}
              {p.aiEnabled ? 'enabled' : 'off'}
            </small>
            {(!p.platformAiEnabled || !p.platformMessagingEnabled) && (
              <small>Platform replies are paused.</small>
            )}
          </span>
          <div>
            <button
              className="text-button"
              disabled={
                !p.aiEnabled && (!p.ready || !p.platformAiEnabled || !p.platformMessagingEnabled)
              }
              aria-label={`${p.aiEnabled ? 'Disable' : 'Enable'} AI for ${p.pageName}`}
              onClick={() =>
                void mutate(`/api/facebook/pages/${p.id}/ai`, { enabled: !p.aiEnabled }, 'PATCH')
                  .then(refresh)
                  .catch((e) => toast(String(e)))
              }
            >
              {p.aiEnabled ? 'Disable AI' : 'Enable AI'}
            </button>
            <button
              className="text-button"
              onClick={() =>
                void mutate<{ connected: boolean }>(`/api/facebook/pages/${p.id}/test`)
                  .then(async (r) => {
                    toast(r.connected ? 'Page connection verified' : 'Page needs reconnection');
                    await refresh();
                  })
                  .catch((e) => toast(String(e)))
              }
            >
              Test
            </button>
            <button className="text-button danger" onClick={() => setDisconnect(p.id)}>
              Disconnect
            </button>
          </div>
        </div>
      ))}
      <button className="button small" disabled={busy} onClick={() => void connect()}>
        <Plus size={15} />
        {busy ? 'Loading Pages…' : 'Connect a Page'}
      </button>
      {available && (
        <Modal title="Choose a Facebook Page" onClose={() => setAvailable(null)}>
          <p className="muted">
            Selecting a Page approves its connection to this workspace. AI replies stay off until
            you enable them separately.
          </p>
          {available.length === 0 && (
            <p>
              No eligible Pages are available. Grant all requested permissions and check your Page
              messaging access.
            </p>
          )}
          {available.map((p) => (
            <button
              className="variant-row"
              key={p.id}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void mutate(`/api/facebook/pages/${p.id}/approve`, { consent: true })
                  .then(refresh)
                  .then(() => {
                    toast('Page connected. Enable AI when you are ready.');
                    setAvailable(null);
                  })
                  .catch((e) => toast(String(e)))
                  .finally(() => setBusy(false));
              }}
            >
              <strong>{p.name}</strong>
              <CheckCircle2 size={18} />
            </button>
          ))}
        </Modal>
      )}
      {disconnect && (
        <Modal title="Disconnect this Page?" onClose={() => setDisconnect(null)}>
          <p>
            The assistant will stop responding on this Page. Existing conversations remain in your
            workspace.
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setDisconnect(null)}>
              Keep connected
            </button>
            <button
              className="button danger-button"
              onClick={() =>
                void mutate<{ unsubscribed: boolean }>(
                  `/api/facebook/pages/${disconnect}`,
                  undefined,
                  'DELETE',
                )
                  .then(async (r) => {
                    await refresh();
                    setDisconnect(null);
                    if (!r.unsubscribed)
                      toast(
                        'Sending is disabled. Facebook could not confirm webhook removal; check the Page subscription.',
                      );
                  })
                  .catch((e) => toast(String(e)))
              }
            >
              Disconnect Page
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
