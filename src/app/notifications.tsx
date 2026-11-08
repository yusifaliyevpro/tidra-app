import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/services/notify";
import { TimeAgo } from "@/ui/time";
import { toastError } from "@/ui/toast";
import { useServices } from "./services";

type Notification = Awaited<ReturnType<typeof listNotifications>>[number];

/** Title bar bell: the in-app list of everything Tidra noticed, newest first. */
export function NotificationBell() {
  const svc = useServices();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { data: items = [] } = useQuery({ queryKey: ["notifications"], queryFn: () => listNotifications(svc) });
  const unread = items.filter((n) => !n.read).length;

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative no-drag">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        title="Notifications"
        onClick={() => setOpen(!open)}
        className={cn(
          "relative flex size-7 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-fg",
          open && "bg-hover text-fg",
        )}
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute top-[5px] right-[5px] size-1.5 rounded-full bg-accent ring-2 ring-canvas" />
        ) : null}
      </button>
      {open ? <NotificationPanel items={items} unread={unread} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function NotificationPanel({ items, unread, onClose }: { items: Notification[]; unread: number; onClose: () => void }) {
  const svc = useServices();
  const navigate = useNavigate();
  const markAll = useMutation({ mutationFn: () => markAllNotificationsRead(svc), onError: toastError });
  const openItem = (item: Notification) => {
    void markNotificationRead(svc, item.key);
    if (item.route) void navigate({ to: item.route });
    onClose();
  };

  return (
    <section
      aria-label="Notifications"
      className="absolute top-full left-0 z-50 mt-1 flex max-h-[480px] w-96 origin-top-right animate-pop-in flex-col overflow-hidden rounded-lg border border-line-strong bg-raised shadow-pop"
    >
      <header className="flex h-10 shrink-0 items-center border-b border-line px-3">
        <span className="font-medium">Notifications</span>
        <button
          type="button"
          disabled={unread === 0}
          onClick={() => markAll.mutate()}
          className="ml-auto text-sm text-muted hover:text-fg disabled:text-faint"
        >
          Mark all read
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? <p className="px-3 py-6 text-center text-muted">No notifications</p> : null}
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => openItem(item)}
            className="flex w-full gap-2.5 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-hover"
          >
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-accent")} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cn("truncate", item.read ? "text-muted" : "text-fg")}>{item.title}</span>
              <span className="line-clamp-2 text-xs text-faint">{item.body}</span>
            </span>
            <span className="shrink-0 text-xs">
              <TimeAgo value={item.createdAt} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
