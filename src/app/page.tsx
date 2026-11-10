import { Suspense } from "react";
import { RoleVisibility } from "@/components/role-visibility";

async function Welcome({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const { welcome } = await searchParams;
  if (welcome !== "copy") return null;
  return (
    <p role="status" className="rounded-md border px-4 py-3 text-sm">
      Your own demo club is ready. You are signed in as Arun, the outgoing lead. The guided tour at
      the bottom of the screen takes you through each step; exit it whenever you like and switch to
      Dr. Meena, Kavya or Divya from the menu at the top right to see what each role can read.
    </p>
  );
}

export default function Home(props: PageProps<"/">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Inheritance</h1>
        <p className="max-w-3xl text-lg text-muted-foreground">
          A handover ledger for student clubs. It reads a club&apos;s WhatsApp exports,
          meeting minutes and Trello board, and lists what the outgoing committee
          leaves behind: promises made to people, and recurring duties with the
          approvals they need. Every claim links to a verified quote; anything
          unsupported is shown as a gap. All demo data is synthetic.
        </p>
      </div>
      <Suspense fallback={null}>
        <Welcome searchParams={props.searchParams} />
      </Suspense>
      <Suspense fallback={<p className="text-muted-foreground">Loading what your role can see…</p>}>
        <RoleVisibility />
      </Suspense>
    </main>
  );
}
