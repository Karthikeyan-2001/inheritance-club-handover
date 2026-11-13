import { Suspense } from "react";
import Link from "next/link";
import { ArrowRightIcon, FileTextIcon, LockIcon, QuoteIcon, ShieldCheckIcon } from "lucide-react";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { NextStep } from "@/components/home/next-step";
import { RoleVisibility } from "@/components/role-visibility";
import { Button } from "@/components/ui/button";
import { getViewer } from "@/lib/session";

export const metadata = { title: "Inheritance: hand a club over without losing a promise" };

const HOW = [
  { icon: FileTextIcon, title: "Read the records", body: "WhatsApp chats, meeting minutes and the Trello board go in. You choose who may see each file." },
  { icon: QuoteIcon, title: "Every claim has a quote", body: "Promises and recurring duties are listed, each with its source quote checked by code. No quote, no claim." },
  { icon: ShieldCheckIcon, title: "Two people sign off", body: "The outgoing lead checks it and the faculty advisor approves a version that can never change." },
  { icon: LockIcon, title: "Each person sees their part", body: "The incoming lead reads only what is approved. The database enforces who sees what, not the screen." },
] as const;

async function Welcome({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const { welcome } = await searchParams;
  if (welcome !== "copy") return null;
  return (
    <p role="status" className="rise-in rounded-2xl border border-primary/20 bg-accent px-5 py-4 text-sm text-accent-foreground">
      Your own demo club is ready. You are signed in as Arun, the outgoing lead. Your next step is below; use
      “Switch person” at the top right to see the club as Dr. Meena, Kavya or Divya.
    </p>
  );
}

function Landing() {
  return (
    <>
      <section className="rise-in flex flex-col items-start gap-5 rounded-3xl border bg-gradient-to-br from-lilac/80 via-card to-card p-7 shadow-md shadow-primary/10 sm:p-10">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Inheritance</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          When a student club changes committee, promises get lost. Inheritance reads the old committee&apos;s chats, minutes and Trello board and lists what they owe:
          promises made to people, and duties that come round every year. Each one links to a verified quote, and anything unsupported is shown as a gap.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild size="lg">
            <Link href="/login">
              Load demo club
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">Takes about half a minute. Everything in the demo is invented.</p>
        </div>
      </section>
      <section aria-labelledby="how" className="flex flex-col gap-4">
        <h2 id="how" className="text-xl font-semibold tracking-tight">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2">
          {HOW.map((h, i) => (
            <li key={h.title} className="rise-in flex gap-4 rounded-2xl border bg-card p-5 shadow-sm shadow-primary/5">
              <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                <h.icon className="size-5" />
              </span>
              <div>
                <p className="font-semibold">
                  <span className="text-primary">{i + 1}.</span> {h.title}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{h.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

async function HomeContent({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <ErrorState title="Could not reach the database">The data service is unavailable right now. Nothing was lost; try again in a minute.</ErrorState>;
  }
  if (!viewer) return <Landing />;
  if (!viewer.membership) {
    return (
      <ErrorState title="No club yet">
        Your account is not a member of any club. If you deleted your demo club, load a new one from the sign-in page.
      </ErrorState>
    );
  }
  return (
    <>
      <Suspense fallback={null}>
        <Welcome searchParams={searchParams} />
      </Suspense>
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Hello, {viewer.name}</h1>
        <p className="max-w-3xl text-muted-foreground" data-testid="page-purpose">
          This is {viewer.membership.workspaceName}. Here is where the handover stands and what to do next.
        </p>
      </div>
      <Suspense fallback={<LoadingBlock label="Working out your next step…" rows={1} variant="list" />}>
        <NextStep viewer={viewer} membership={viewer.membership} />
      </Suspense>
      <Suspense fallback={<LoadingBlock label="Checking what your role can read…" rows={3} variant="table" />}>
        <RoleVisibility />
      </Suspense>
    </>
  );
}

export default function Home(props: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <Suspense fallback={<LoadingBlock label="Loading…" rows={2} />}>
        <HomeContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
