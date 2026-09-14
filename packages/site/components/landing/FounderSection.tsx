import { Mail } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { founder } from '@/lib/founder';
import { FounderAvatar } from './FounderAvatar';

export function FounderSection() {
  return (
    <section id="support" className="border-x border-border mx-auto max-w-screen-xl">
      <div className="flex flex-col gap-6 px-8 py-12 sm:px-10 sm:py-16 md:flex-row md:items-center md:justify-between">
        <div className="flex max-w-2xl items-start gap-4">
          <FounderAvatar size={44} className="mt-0.5" />
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Talk directly to the founder</h2>
            <blockquote className="mt-2 space-y-2 text-base italic leading-relaxed text-foreground/75">
              <p>
                &ldquo;OtaKit is built and operated by me, and I&rsquo;m always happy to help.
                Whether you&rsquo;re setting up your first app, migrating from another provider, or
                preparing a production release, email me anytime.
              </p>
              <p>You&rsquo;ll get a direct answer from the person building OtaKit.&rdquo;</p>
            </blockquote>
            <p className="mt-2 text-sm text-muted-foreground">
              <a
                href={founder.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground transition-colors hover:text-muted-foreground"
              >
                {founder.name}
              </a>
              , {founder.role}
            </p>
          </div>
        </div>
        <Button asChild variant="outline" className="w-fit shrink-0 rounded-full px-5">
          <a href={`mailto:${founder.email}`}>
            <Mail className="size-4" />
            {founder.email}
          </a>
        </Button>
      </div>
    </section>
  );
}
