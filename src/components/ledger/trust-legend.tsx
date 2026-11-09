import { TRUST_HELP, TRUST_LABELS } from "./commitments";

const ORDER = ["corroborated", "sourced", "inferred", "contradicted", "gap"] as const;

/** One legend for the five trust states, so cards do not repeat the sentence. */
export function TrustLegend() {
  return (
    <details className="rounded-md border p-3 text-sm" data-testid="trust-legend">
      <summary className="cursor-pointer font-medium">What the trust labels mean</summary>
      <p className="mt-2 text-muted-foreground">Set by a fixed rule over the verified quotes, never by a model and never guessed.</p>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
        {ORDER.map((k) => (
          <div key={k} className="contents">
            <dt className="font-medium">{TRUST_LABELS[k]}</dt>
            <dd className="text-muted-foreground">{TRUST_HELP[k]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
