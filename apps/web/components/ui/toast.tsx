'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/cn';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const ICONS = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
} as const;

const TONE = {
  success: 'text-feedback-success',
  error: 'text-feedback-danger',
  info: 'text-feedback-info',
} as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // The stack is newest-at-bottom (closest to the corner it rises from). If
  // enough fire at once to overflow the capped container, keep the newest
  // one in view rather than leaving the viewer looking at the oldest.
  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
  }, [toasts.length]);

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, kind, message }]);
      window.setTimeout(() => remove(id), 4200);
    },
    [remove],
  );

  const value: ToastApi = {
    show,
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        ref={containerRef}
        className="pointer-events-none fixed bottom-6 right-6 z-[1000] flex max-h-[calc(100vh-3rem)] w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-sm overflow-y-auto"
        aria-live="polite"
        role="status"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const Icon = ICONS[t.kind];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="pointer-events-auto flex items-start gap-sm rounded-lg border border-border-subtle bg-bg-elevated p-md shadow-lg"
              >
                <Icon className={cn('mt-[1px] h-5 w-5 shrink-0', TONE[t.kind])} strokeWidth={2} />
                <p className="flex-1 text-body text-ink-80">{t.message}</p>
                <button
                  onClick={() => remove(t.id)}
                  className="shrink-0 rounded-sm p-[2px] text-ink-40 transition-colors hover:text-ink-80"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
