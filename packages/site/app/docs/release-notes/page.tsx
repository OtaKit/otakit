import Link from 'next/link';

import { Separator } from '@/components/ui/separator';
import { Pre } from '@/app/docs/CodeBlock';

export const metadata = {
  title: 'Release Notes',
  description:
    'Attach short notes to a release and show them once in the app as a "What\'s new" screen.',
};

export default function ReleaseNotesPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Release Notes</h1>
      <P>
        Attach a few lines to a release, such as &ldquo;Faster checkout. Photo upload fixed on
        Android.&rdquo; Your team sees them next to the release in the dashboard, and the app can
        show them once after the update as a &ldquo;What&apos;s new&rdquo; screen.
      </P>
      <P>
        Notes are plain text with line breaks, up to 2,000 characters. Showing them in the app needs{' '}
        <Code>@otakit/capacitor-updater</Code> 3.3 or later; everything else works with any plugin
        version.
      </P>

      <Separator className="my-10" />

      <H2>Write notes when you release</H2>
      <P>
        In the dashboard, the release dialog has a &ldquo;Release notes&rdquo; field. From the CLI:
      </P>
      <Pre>{`otakit release --channel production --notes "Faster checkout.
Photo upload fixed on Android."

# Or from a file, in the same command that uploads
otakit upload --release production --notes-file NOTES.md`}</Pre>
      <P>
        Agents pass <Code>notes</Code> to <Code>prepare_release</Code> and{' '}
        <Code>publish_release</Code>, and show you the text before publishing. Over the API, send{' '}
        <Code>notes</Code> with the release; see the{' '}
        <Link href="/docs/api" className="font-medium text-foreground underline underline-offset-4">
          REST API
        </Link>
        .
      </P>
      <P>
        Notes belong to the release, so the same bundle can carry different notes on beta and
        production. Write them for the people using your app: what changed for them, in a few short
        lines.
      </P>

      <Separator className="my-10" />

      <H2>Show &ldquo;What&apos;s new&rdquo; in the app</H2>
      <P>
        After an update, <Code>getUnseenReleaseNotes()</Code> returns the running release&apos;s
        notes until you mark them seen, so each release shows once per phone:
      </P>
      <Pre>{`import { OtaKit } from '@otakit/capacitor-updater';

const notes = await OtaKit.getUnseenReleaseNotes(); // { text, version, releaseId } or null
if (notes) {
  showWhatsNew(notes.text);
  await OtaKit.markReleaseNotesSeen();
}

function showWhatsNew(text: string) {
  const sheet = document.createElement('div');
  sheet.className = 'whats-new';
  sheet.textContent = text; // plain text: never insert it as HTML
  document.body.append(sheet);
}`}</Pre>
      <P>
        Render notes as text, with <Code>white-space: pre-line</Code> for line breaks. Never insert
        them as HTML. The bundle the app is running also exposes its notes as{' '}
        <Code>getState().current.notes</Code> and in the <Code>updateApplied</Code> event.
      </P>

      <Separator className="my-10" />

      <H2>Edit notes later</H2>
      <P>
        Fix a typo or polish the copy from the release&apos;s menu in the dashboard (&ldquo;Edit
        release notes&rdquo;) or with <Code>PATCH /releases/:releaseId/notes</Code>. Phones that
        update from then on get the new text; phones that already updated keep the notes they
        received.
      </P>

      <Separator className="my-10" />

      <H2>Security</H2>
      <P>
        Notes travel in their own signed block of the release manifest. The app only shows notes
        signed for that exact release, so they cannot be changed in transit. Older plugin versions
        ignore the block and update as before.
      </P>
    </>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold tracking-tight">{children}</h2>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-muted-foreground">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{children}</code>;
}
