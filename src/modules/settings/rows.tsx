import { useId, type ReactNode } from "react";

/** A titled block of setting rows, separated by hairlines like a native settings pane. */
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {title ? <h2 className="px-1 text-sm font-medium text-muted">{title}</h2> : null}
      <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">{children}</div>
    </section>
  );
}

/** Label on the left, control on the right. Pass a function to get an id for the control's label. */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode | ((id: string) => ReactNode);
}) {
  const id = useId();
  const labelled = typeof children === "function";
  return (
    <div className="flex min-h-12 items-center gap-6 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col">
        {labelled ? <label htmlFor={id}>{label}</label> : <span>{label}</span>}
        {description ? <span className="text-sm text-muted">{description}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{labelled ? children(id) : children}</div>
    </div>
  );
}
