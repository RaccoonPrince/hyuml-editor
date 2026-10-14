import { useEffect } from 'react';
import { useDiagramStore } from '../store/useDiagramStore';

const COLORS = { info: '#004b87', warning: '#b45309', error: '#b91c1c' } as const;

export function Toast() {
  const toast = useDiagramStore((s) => s.toast);
  const dismiss = useDiagramStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismiss, toast.kind === 'error' ? 6000 : 4000);
    return () => clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;
  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className="hy-no-export"
      style={{
        position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 50,
        maxWidth: 'min(560px, calc(100% - 32px))', display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', borderRadius: 6, background: COLORS[toast.kind], color: '#fff',
        boxShadow: '0 6px 18px rgba(0,0,0,0.2)', fontSize: 13,
      }}
    >
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button type="button" aria-label="알림 닫기" onClick={dismiss}
        style={{ border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 16 }}>
        ×
      </button>
    </div>
  );
}
