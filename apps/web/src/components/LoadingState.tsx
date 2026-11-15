export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-border bg-card/60 px-4 py-16">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
        {label}
      </div>
    </div>
  );
}
