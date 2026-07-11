import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type PublicStore } from "./lib/api";
import { resolveStoreSlug } from "./lib/store";

interface StoreState {
  store: PublicStore | null;
  loading: boolean;
  error: string | null;
}

const Ctx = createContext<StoreState>({ store: null, loading: true, error: null });

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StoreState>({ store: null, loading: true, error: null });

  useEffect(() => {
    const slug = resolveStoreSlug();
    if (!slug) {
      setState({ store: null, loading: false, error: "لم نتعرف على المتجر" });
      return;
    }
    api<{ store: PublicStore }>(`/v1/public/stores/${slug}`)
      .then(({ store }) => {
        document.title = store.name;
        setState({ store, loading: false, error: null });
      })
      .catch(() => setState({ store: null, loading: false, error: "المتجر غير موجود" }));
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useStore() {
  return useContext(Ctx);
}
