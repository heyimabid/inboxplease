import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  Component,
  type ErrorInfo,
} from 'react';
import { X, Inbox, AlertCircle, LoaderCircle } from 'lucide-react';
const ToastContext = createContext<(message: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState('');
  return (
    <ToastContext.Provider value={setToast}>
      {children}
      {toast && (
        <div role="status" className="toast">
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={22} /> Loading your workspace…
    </div>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="error" role="alert">
      <AlertCircle size={17} />
      {message}
    </div>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <dialog
      open
      ref={(node) => {
        if (node && !node.dataset.modal) {
          node.close();
          node.showModal();
          node.dataset.modal = 'true';
        }
      }}
      onCancel={onClose}
      className="modal"
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Details stay out of the browser console to avoid exposing customer data. */
  }
  render() {
    return this.state.error ? (
      <main className="auth-card">
        <h1>This view could not load.</h1>
        <p>Your saved work is still available.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload workspace
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
