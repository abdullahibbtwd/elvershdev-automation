import { X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /** When set, user must type this phrase (case-insensitive) before confirming. */
  confirmPhrase?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive styling for high-risk actions. */
  variant?: 'default' | 'destructive';
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId();
  const inputId = useId();
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pending, onOpenChange]);

  if (!open) return null;

  const phraseOk =
    !confirmPhrase || typed.trim().toUpperCase() === confirmPhrase.trim().toUpperCase();
  const canConfirm = phraseOk && !pending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onOpenChange(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id={titleId} className="text-lg font-semibold leading-snug">
            {title}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 p-4">
          {description ? (
            <div className="text-sm text-muted-foreground whitespace-pre-line">{description}</div>
          ) : null}

          {confirmPhrase ? (
            <div className="space-y-2">
              <Label htmlFor={inputId} className="normal-case tracking-normal">
                Type <span className="font-semibold text-foreground">{confirmPhrase}</span> to
                confirm
              </Label>
              <Input
                id={inputId}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={typed}
                disabled={pending}
                placeholder={confirmPhrase}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canConfirm) void onConfirm();
                }}
              />
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={variant === 'destructive' ? 'destructive' : 'default'}
              disabled={!canConfirm}
              onClick={() => void onConfirm()}
            >
              {pending ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
