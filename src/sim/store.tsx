import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { apply, fresh, tick, type Action, type SimState } from "./state";

export interface Sim {
  readonly state: SimState;
  dispatch(a: Action): void;
  tick(): void;
  reset(): void;
  subscribe(l: () => void): () => void;
  version(): number;
}

/** A tiny mutable store: state is mutated in place and a version counter drives re-renders. */
export function createSim(initial: SimState = fresh()): Sim {
  let S = initial;
  let v = 0;
  const ls = new Set<() => void>();
  const bump = () => {
    v++;
    ls.forEach((l) => l());
  };
  return {
    get state() {
      return S;
    },
    dispatch(a) {
      apply(S, a);
      bump();
    },
    tick() {
      tick(S);
      bump();
    },
    reset() {
      S = fresh();
      bump();
    },
    subscribe(l) {
      ls.add(l);
      return () => ls.delete(l);
    },
    version: () => v,
  };
}

const Ctx = createContext<Sim | null>(null);

export function SimProvider({ sim, intervalMs = 100, children }: { sim?: Sim; intervalMs?: number; children: ReactNode }) {
  const s = useMemo(() => sim ?? createSim(), [sim]);
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = window.setInterval(() => s.tick(), intervalMs);
    return () => window.clearInterval(id);
  }, [s, intervalMs]);
  return <Ctx.Provider value={s}>{children}</Ctx.Provider>;
}

/** Subscribe to the simulation; re-renders on every change. */
export function useSim(): { S: SimState; dispatch: (a: Action) => void; reset: () => void } {
  const sim = useContext(Ctx);
  if (!sim) throw new Error("useSim outside SimProvider");
  useSyncExternalStore(sim.subscribe, sim.version);
  return { S: sim.state, dispatch: sim.dispatch, reset: sim.reset };
}
