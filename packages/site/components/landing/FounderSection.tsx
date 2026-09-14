import { ArrowRightLeft, Linkedin, Mail, MessagesSquare, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { founder } from '@/lib/founder';
import { FounderAvatar } from './FounderAvatar';

const SUPPORT_POINTS = [
  {
    icon: MessagesSquare,
    title: 'Direct line to the founder',
    description:
      'No support tiers, bots, or hand-offs. Your question reaches the person who builds the product.',
  },
  {
    icon: ArrowRightLeft,
    title: 'Migration assistance',
    description:
      'Switching from Capgo, Capawesome, or Appflow? Get help planning the move and verifying your first release.',
  },
  {
    icon: ShieldCheck,
    title: 'Production readiness',
    description:
      'Review your channels, rollback setup, and update strategy before your first release reaches users.',
  },
];

export function FounderSection() {
  return (
    <section id="support" className="border-x border-border mx-auto max-w-screen-xl">
      <div className="overflow-hidden">
        <div className="border-b border-border px-8 py-10 pt-30">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Support
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
            Work directly with the founder
          </h2>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            No ticket queues or chatbots. Every question is answered by the person who builds
            OtaKit.
          </p>
        </div>
        <div className="grid gap-px bg-border lg:grid-cols-[3fr_2fr]">
          <div className="flex flex-col bg-background p-8 sm:p-12">
            <div className="max-w-2xl space-y-4 text-[17px] leading-relaxed text-foreground/80">
              <p>
                I built OtaKit so teams can ship fixes and improvements to their Capacitor apps the
                moment they are ready, without waiting on store review.
              </p>
              <p>
                When you reach out, you talk to me. Whether you are setting up your first release,
                moving from another provider, or rolling out to a large user base, you get answers
                from someone who knows the system end to end.
              </p>
              <p>
                Evaluating OtaKit for your team? Send me an email. I am happy to answer technical
                questions and walk through your release workflow.
              </p>
            </div>

            <a
              href={founder.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-8 inline-flex w-fit items-center gap-3"
            >
              <FounderAvatar size={40} />
              <span>
                <span className="block text-sm font-semibold underline-offset-4 group-hover:underline">
                  {founder.name}
                </span>
                <span className="block text-sm text-muted-foreground">{founder.role}</span>
              </span>
            </a>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full px-6">
                <a href={`mailto:${founder.email}`}>
                  <Mail className="size-4" />
                  {founder.email}
                </a>
              </Button>
              <Button asChild variant="outline" size="lg" className="rounded-full px-6">
                <a href={founder.linkedin} target="_blank" rel="noopener noreferrer">
                  <Linkedin className="size-4" />
                  Connect on LinkedIn
                </a>
              </Button>
            </div>
          </div>
          <div className="grid gap-px bg-border">
            {SUPPORT_POINTS.map(({ icon: Icon, title, description }) => (
              <div key={title} className="bg-background p-8 sm:p-10">
                <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted">
                  <Icon className="size-5 text-muted-foreground" />
                </div>
                <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
