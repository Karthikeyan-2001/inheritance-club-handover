import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Ten-minute walkthrough · Inheritance" };

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span aria-hidden="true" className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium">
        {n}
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="font-medium">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

/** A walkthrough for a first-time visitor (a judge): what to click, and what to look for. */
export default function GuidePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-3">
        <Badge variant="outline" className="w-fit">Synthetic demo data</Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Try Inheritance in ten minutes</h1>
        <p className="text-muted-foreground">
          Inheritance reads a student club&apos;s WhatsApp exports, Trello board and meeting minutes, and
          builds a ledger of what the outgoing committee still owes: promises made to people, and
          duties that come round every semester with the approvals they need. Arun is handing the
          club over to Kavya; Dr. Meena is the faculty advisor; Divya is the treasurer. Every person,
          club and message here is invented.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            <h2>Path A: explore a built handover</h2>
          </CardTitle>
          <CardDescription>About ten minutes. No files needed.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-5">
            <Step n={1} title="Get your own club">
              <p>
                On <Link className="underline" href="/login">Sign in</Link>, press <strong>Explore a built handover</strong>. You get a
                private copy of a year of an IoT club&apos;s records, with four accounts of its own, and you are
                signed in as Arun, the outgoing lead. Nothing you do reaches other visitors.
              </p>
            </Step>
            <Step n={2} title="Connect: see the sources and who may read them">
              <p>
                Open <strong>Connect</strong>. Five files are listed with their access level: a volunteers chat
                (everyone), a committee chat and the Trello board (committee), finance minutes (finance), and
                Dr. Meena&apos;s private chat (private). Arun cannot see Dr. Meena&apos;s file at all; the database
                does not return it to him.
              </p>
            </Step>
            <Step n={3} title="Reconstruct: read the ledger">
              <p>
                Open <strong>Reconstruct</strong>. Each card is a promise (who owes whom, what, by when) or a recurring
                duty (how often, whose approval, when to start). The label on each card is its trust state, set
                by a fixed rule, never by the model: <em>corroborated</em> (two independent records agree),
                <em> sourced</em> (one verified quote), <em>inferred</em> (only implied, never shown as fact),
                <em> contradicted</em>, or <em>gap</em>.
              </p>
              <p>
                Press <strong>Open source message</strong> on any quote: the original message is shown with the quote
                highlighted. Code checked that every quote really is in its message before the item was stored.
              </p>
            </Step>
            <Step n={4} title="Verify: what disagrees, and what is missing">
              <p>
                The <strong>Docket</strong> tab lists records that disagree (a Trello card moved to Done while the chat
                says it was not done), with both quotes. The <strong>Gaps</strong> tab lists promises with no follow-up
                and items shown as <em>No evidence kept</em>, instead of guessing that they were done.
              </p>
            </Step>
            <Step n={5} title="Review: check the drafts and sign off">
              <p>
                Open <strong>Review</strong>. Version 1 is already approved. A few items are still drafts: these are things
                the model found that a person should check, and some are wrong. Accept or reject each one (a reason
                is required, and every action is written to the History tab). Then press
                <strong> Mark ready for the advisor</strong>.
              </p>
              <p>
                Switch to Dr. Meena from the menu at the top right. On <strong>Conflicts</strong> she can rule on each
                disagreement; on <strong>Draft</strong> she presses <strong>Approve this version</strong> to make version 2.
                Approved versions can never be edited, only replaced by a newer one.
              </p>
            </Step>
            <Step n={6} title="Handover: what the incoming lead sees">
              <p>
                Switch to Kavya and open <strong>Handover</strong>: the people waiting on her, a calendar of recurring
                duties with &quot;start now&quot; dates, and sealed placeholders for finance and private matters she may not
                read. She can accept an item, ask a question or decline it; Arun and Dr. Meena see her answers and can
                reply to a question.
              </p>
            </Step>
            <Step n={7} title="Compare the roles">
              <p>
                Switch between Arun, Dr. Meena, Kavya and Divya and open the same pages. Kavya never sees the
                working ledger, only approved versions; Divya sees finance items; only Dr. Meena sees her private
                chat. These differences come from Postgres row-level security, not from hiding things on screen.
              </p>
            </Step>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            <h2>Path B: build one from files yourself</h2>
          </CardTitle>
          <CardDescription>About ten minutes, of which building takes two or three.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-5">
            <Step n={1} title="Start an empty club">
              <p>On <Link className="underline" href="/login">Sign in</Link>, press <strong>Start from your own files</strong>. You land on Connect as Arun.</p>
            </Step>
            <Step n={2} title="Import the sample files">
              <p>
                Download the photography club&apos;s four sample files from Connect, choose them all, set each to the
                level shown next to its link (committee, finance, private, committee), tick the authorisation box
                and import. The page reports what was read from each file.
              </p>
            </Step>
            <Step n={3} title="Build the ledger">
              <p>
                Open Reconstruct and press <strong>Build the ledger</strong>. The model (Claude Haiku, through one adapter)
                reads only messages Arun may read, a few at a time, and the progress bar shows each stage.
                Everything it proposes is checked by code before it is stored, and arrives as a draft.
              </p>
            </Step>
            <Step n={4} title="Review, approve and hand over">
              <p>Then follow steps 4 to 7 of Path A: accept or reject the drafts, mark ready, approve as Dr. Meena, and read the handover as Kavya.</p>
            </Step>
          </ol>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-2 text-sm text-muted-foreground">
        <h2 className="text-base font-medium text-foreground">Good to know</h2>
        <ul className="list-disc pl-5">
          <li>Your club and its accounts are deleted after seven days. You can return to it from Sign in, or start a fresh one.</li>
          <li>The model makes mistakes; that is why nothing reaches the incoming lead until a person has reviewed it and the advisor has approved it.</li>
          <li>The source code, the architecture and the test results are in the repository README.</li>
        </ul>
      </section>
    </main>
  );
}
