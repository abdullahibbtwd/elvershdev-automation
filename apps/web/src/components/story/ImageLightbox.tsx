import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export type LightboxImage = {
  url: string;
  title: string;
  subtitle?: string | null;
};

export function ImageLightbox({
  images,
  activeIndex,
  onClose,
  onChangeIndex,
}: {
  images: LightboxImage[];
  activeIndex: number | null;
  onClose: () => void;
  onChangeIndex?: (index: number) => void;
}) {
  const isOpen = activeIndex !== null && activeIndex >= 0 && activeIndex < images.length;
  const current = isOpen ? images[activeIndex] : null;
  const canNavigate = images.length > 1 && Boolean(onChangeIndex);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft' && canNavigate && activeIndex !== null) {
        onChangeIndex?.((activeIndex - 1 + images.length) % images.length);
      } else if (event.key === 'ArrowRight' && canNavigate && activeIndex !== null) {
        onChangeIndex?.((activeIndex + 1) % images.length);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeIndex, canNavigate, images.length, onClose, onChangeIndex]);

  if (!isOpen || !current || activeIndex === null) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={current.title}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{current.title}</h3>
            {images.length > 1 && (
              <p className="text-xs text-muted-foreground">
                {activeIndex + 1} of {images.length}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={current.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground hover:bg-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </a>
            <Button type="button" variant="outline" size="icon" onClick={onClose} aria-label="Close preview">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="relative flex flex-1 items-center justify-center bg-slate-900 p-4">
          {canNavigate && (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 opacity-90"
              aria-label="Previous image"
              onClick={() => onChangeIndex?.((activeIndex - 1 + images.length) % images.length)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}

          <img
            src={current.url}
            alt={current.title}
            className="max-h-[68vh] w-auto max-w-full rounded object-contain"
          />

          {canNavigate && (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 opacity-90"
              aria-label="Next image"
              onClick={() => onChangeIndex?.((activeIndex + 1) % images.length)}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          )}
        </div>

        {current.subtitle && (
          <div className="max-h-28 overflow-y-auto border-t bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
            {current.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
