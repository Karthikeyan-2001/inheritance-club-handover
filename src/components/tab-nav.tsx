import { TabLink } from "@/components/tab-link";

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
        {tabs.map((t) => (
          <li key={t.key}>
            <TabLink href={`${basePath}?tab=${t.key}`} on={t.key === current} title={t.hint}>
              {t.label}
            </TabLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
