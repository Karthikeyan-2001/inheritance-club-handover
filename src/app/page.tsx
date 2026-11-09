import { StepIndicator } from "@/components/step-indicator";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <Badge variant="outline" className="w-fit">
        Demo uses synthetic data only
      </Badge>
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">Inheritance</h1>
        <p className="text-lg text-muted-foreground">
          A handover ledger for student clubs. It reads a club&apos;s WhatsApp exports,
          meeting minutes and Trello board, and lists what the outgoing committee
          leaves behind: promises made to people, and recurring duties with the
          approvals they need. Every claim links to a verified quote; anything
          unsupported is shown as a gap.
        </p>
      </div>
      <StepIndicator />
    </main>
  );
}
