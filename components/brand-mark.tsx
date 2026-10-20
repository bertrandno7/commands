export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-lockup" aria-label="COMMANDS home">
      <svg
        className="brand-symbol"
        viewBox="0 0 48 48"
        aria-hidden="true"
      >
        <path d="M7 13.5 24 5l17 8.5v20L24 43l-6.4-3.8 8.5-5.3 8.5-4.7V18.1L24 13 13.6 18.2v11l8.2-4.2v7.4L7 40Z" />
        <path className="brand-symbol-accent" d="m17.5 29.8 8.8-4.7 8 3.9-9 5.1z" />
      </svg>
      {!compact && <span className="brand-word">commands</span>}
    </span>
  );
}
