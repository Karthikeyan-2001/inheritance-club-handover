import Link from "next/link";

/** Section tabs as links (so each is a URL). The current one is filled; each can carry a short hint. */
export function TabNav<K extends string>({
  label,
  basePath,
  tabs,
  current,
}: {
  label: string;
  basePath: string;
  tabs: readonly { key: K; label: string; hint?: string }[];
  current: K;
}) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-1.5 rounded-2xl border bg-secondary/60 p-1.5 text-sm">
        {tabs.map((t) => {
          const on = t.key === current;
          return (
            <li key={t.key}>
              <Link
                href={`${basePath}?tab=${t.key}`}
                aria-current={on ? "page" : undefined}
                title={t.hint}
                className={
                  on
                    ? "block rounded-xl bg-card px-4 py-2 font-semibold text-primary shadow-sm"
                    : "block rounded-xl px-4 py-2 text-secondary-foreground transition-colors hover:bg-card/70"
                }
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
