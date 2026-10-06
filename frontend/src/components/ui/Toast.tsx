import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function Toast({ children }: { children?: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const getBgColor = (type: ToastType) => {
    switch (type) {
      case 'success': return 'bg-green-600';
      case 'error': return 'bg-red-600';
      case 'warning': return 'bg-orange-500';
      case 'info': return 'bg-blue-600';
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {createPortal(
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
          {toasts.map((t) => (
            <div key={t.id} className={`px-4 py-3 rounded shadow-lg text-white font-medium ${getBgColor(t.type)} animate-in slide-in-from-right-5 fade-in duration-300`}>
              {t.message}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}
