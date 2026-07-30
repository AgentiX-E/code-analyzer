// @code-analyzer/web — Toast Notification System
// Lightweight toast notification component supporting multiple variants,
// auto-dismiss, and stacking. No external dependencies required.

import React, { useState, useCallback, useEffect, createContext, useContext } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  /** Unique toast ID */
  id: string;
  /** Toast variant (controls icon and color) */
  variant: ToastVariant;
  /** Main message text */
  message: string;
  /** Optional detail text */
  detail?: string;
  /** Duration in ms before auto-dismiss (0 = no auto-dismiss) */
  duration?: number;
  /** Whether the toast can be manually dismissed */
  dismissible?: boolean;
}

export interface ToastContextValue {
  /** Add a new toast notification */
  addToast: (toast: Omit<ToastMessage, 'id'>) => string;
  /** Dismiss a toast by ID */
  dismissToast: (id: string) => void;
  /** Dismiss all toasts */
  dismissAll: () => void;
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

const VARIANT_ICONS: Record<ToastVariant, string> = {
  success: '\u2714',  // ✔
  error: '\u2718',    // ✘
  warning: '\u26A0',  // ⚠
  info: '\u2139',     // ℹ
};

const VARIANT_COLORS: Record<ToastVariant, string> = {
  success: 'var(--success, #3fb950)',
  error: 'var(--error, #f85149)',
  warning: 'var(--warning, #d29922)',
  info: 'var(--accent-cyan, #58a6ff)',
};

const VARIANT_BG: Record<ToastVariant, string> = {
  success: 'var(--success-muted, #1a3a2a)',
  error: 'var(--error-muted, #3a1a1a)',
  warning: 'var(--warning-muted, #3a2a1a)',
  info: 'var(--info-muted, #1a2a3a)',
};

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const ToastContext = createContext<ToastContextValue | null>(null);

/** Hook to access the toast notification system from any component */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export interface ToastProviderProps {
  children: React.ReactNode;
  /** Maximum number of visible toasts (default: 5) */
  maxToasts?: number;
  /** Default auto-dismiss duration in ms (default: 5000) */
  defaultDuration?: number;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({
  children,
  maxToasts = 5,
  defaultDuration = 5000,
}) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  let idCounter = 0;

  const addToast = useCallback(
    (toast: Omit<ToastMessage, 'id'>): string => {
      const id = `toast-${Date.now()}-${++idCounter}`;
      const duration = toast.duration ?? defaultDuration;

      setToasts((prev) => {
        const next = [...prev, { ...toast, id, duration }];
        // Enforce max limit — remove oldest first
        while (next.length > maxToasts) {
          next.shift();
        }
        return next;
      });

      return id;
    },
    [maxToasts, defaultDuration],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const value: ToastContextValue = { addToast, dismissToast, dismissAll };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
};

/* ------------------------------------------------------------------ */
/*  Container                                                          */
/* ------------------------------------------------------------------ */

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="log" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Toast Item                                                         */
/* ------------------------------------------------------------------ */

interface ToastItemProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (!toast.duration || toast.duration <= 0) return;

    const timer = setTimeout(() => {
      setExiting(true);
      // Wait for exit animation before removing
      setTimeout(() => onDismiss(toast.id), 300);
    }, toast.duration);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`toast toast--${toast.variant}${exiting ? ' toast--exiting' : ''}`}
      role="alert"
      style={{
        borderLeftColor: VARIANT_COLORS[toast.variant],
        backgroundColor: VARIANT_BG[toast.variant],
      }}
    >
      <span className="toast__icon" aria-hidden="true">
        {VARIANT_ICONS[toast.variant]}
      </span>
      <div className="toast__content">
        <span className="toast__message">{toast.message}</span>
        {toast.detail && (
          <span className="toast__detail">{toast.detail}</span>
        )}
      </div>
      {(toast.dismissible !== false) && (
        <button
          className="toast__dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss notification"
          type="button"
        >
          &times;
        </button>
      )}
    </div>
  );
};

export default ToastProvider;
