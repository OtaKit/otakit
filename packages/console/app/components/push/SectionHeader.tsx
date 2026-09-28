import { cn } from '@/lib/utils';

/** Section title row, the same as the sections on the main dashboard. */
export function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-6 pb-5 pt-8">
      <div className="mr-5 flex items-center gap-3">
        <Icon className="size-6 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
          <p className="text-xs leading-tight text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** The Updates table styling from the main dashboard. */
export const TABLE_CLASS =
  'w-full table-fixed text-xs [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_td]:border-r [&_td]:border-border [&_td]:py-2 [&_td:last-child]:border-r-0 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6 [&_th]:border-r [&_th]:border-border [&_th:last-child]:border-r-0';

type Tone = 'green' | 'blue' | 'red' | 'muted';

const TONES: Record<Tone, { pill: string; dot: string }> = {
  green: {
    pill: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-500/25',
    dot: 'bg-emerald-500',
  },
  blue: {
    pill: 'bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:bg-sky-500/15 dark:text-sky-400 dark:ring-sky-500/25',
    dot: 'bg-sky-500',
  },
  red: {
    pill: 'bg-red-500/10 text-red-700 ring-red-500/30 dark:bg-red-500/15 dark:text-red-400 dark:ring-red-500/25',
    dot: 'bg-red-500',
  },
  muted: { pill: 'bg-muted text-muted-foreground ring-border', dot: 'bg-muted-foreground/50' },
};

/** Small status pill, the same shape as the release pill on the Updates table. */
export function StatusPill({
  tone,
  pulse,
  children,
}: {
  tone: Tone;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  const { pill, dot } = TONES[tone];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        pill,
      )}
    >
      <span className="relative flex size-1.5 shrink-0">
        {pulse ? (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
              dot,
            )}
          />
        ) : null}
        <span className={cn('relative inline-flex size-1.5 rounded-full', dot)} />
      </span>
      {children}
    </span>
  );
}

export function formatDateOnly(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

export function formatTimeOnly(value: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

export function deviceCount(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'device' : 'devices'}`;
}

export const PUSH_DOCS_URL = 'https://otakit.app/docs/push';
