import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { POLL_INTERVALS } from "../lib/constants";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      api<{ data: Notification[]; unreadCount: number }>("/v1/notifications"),
    refetchInterval: POLL_INTERVALS.notifications,
  });

  const markAll = useMutation({
    mutationFn: () => api("/v1/notifications/read", { method: "POST", body: { all: true } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = q.data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          if (!open && unread > 0) markAll.mutate();
        }}
        className="relative rounded-full p-2 hover:bg-stone-100"
        aria-label="الإشعارات"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-2 max-h-96 w-80 overflow-y-auto rounded-xl border border-stone-200 bg-white shadow-lg">
          {(q.data?.data ?? []).length === 0 ? (
            <p className="p-6 text-center text-sm text-stone-400">مفيش إشعارات</p>
          ) : (
            (q.data?.data ?? []).map((n) => (
              <div key={n.id} className={`border-b border-stone-100 p-3 ${n.read_at ? "" : "bg-amber-50/50"}`}>
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="mt-0.5 text-xs text-stone-500">{n.body}</p>}
                <p className="mt-1 text-xs text-stone-400">
                  {new Date(n.created_at).toLocaleString("ar-EG")}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
