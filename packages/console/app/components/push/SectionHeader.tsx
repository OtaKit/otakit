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
      <div className="flex items-center gap-3">
        <Icon className="size-6 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
          <p className="text-xs leading-tight text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children ? <div className="ml-auto flex items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Table styling shared by the push sections, matching the Updates table. */
export const TABLE_CLASS =
  'w-full text-xs [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_td]:py-2 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6';
