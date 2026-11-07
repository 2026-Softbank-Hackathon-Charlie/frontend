// The migration map (public/migration-map-live.html, the handoff's migration-map.html without its simulator) in a
// same-origin iframe, fed the console's migration state as a snapshot at every stage. In demo mode the state is the
// console's simulation, in live mode the platform: plans, AI sessions, the run over SSE and the gateway.
// The map's buttons come back as {type:"hc-cmd"} and run the same actions as the rest of the page.
import { useEffect, useRef, useState } from "react";
import { useAIActivity, useApp, useEnvironments, useSourceRetention, useTraffic } from "../api/hooks";
import { useAuth } from "../data/live";
import type { AIActivity, App, Environment, TrafficState } from "../api/types";
import type { MigrationView } from "../data/migration";
import { buildMapSnapshot, type MapAction, type MapSnapshot } from "../data/mapSnapshot";

/** how far back the map's AI numbers look */
const AI_MINUTES = 60;

export const MAP_SRC = import.meta.env.BASE_URL + "migration-map-live.html";

export interface MapFrameProps {
  v: MigrationView;
  /** the run's headline and explanation */
  hero?: [string, string];
}

export function MigrationMapFrame(p: MapFrameProps) {
  return p.v.live ? <LiveFrame {...p} /> : <MapFrame {...p} />;
}

function LiveFrame(p: MapFrameProps) {
  // the migrating app's gateway scope, which its run holds and routes
  const traffic = useTraffic(2000, "30s", p.v.app || undefined);
  const envs = useEnvironments(30000);
  // what the target environment already runs of the app (its instance status)
  const app = useApp(p.v.app, 15000);
  // what hopai really did in the last hour, from the observability logs; a 502 or 503 just leaves the numbers out
  const ai = useAIActivity(10000, AI_MINUTES);
  // resume is an operator command (the platform answers 403 to other roles)
  const operator = useAuth().session?.principal.role === "operator";
  const retention = useSourceRetention(p.v.run?.status === "succeeded" ? p.v.run.runId : null);
  const canRollback = p.v.run?.status !== "succeeded" || (!!retention.data && !retention.error && !["deleting", "deleted"].includes(retention.data.job?.status ?? ""));
  return <MapFrame {...p} traffic={traffic.data} envs={envs.data} app={app.data} ai={ai.error ? undefined : ai.data} canResume={operator} canRollback={canRollback} />;
}

const RUN: Record<MapAction, (v: MigrationView) => void> = {
  approve: (v) => v.approve(),
  switch: (v) => v.doSwitch(),
  abort: (v) => v.abort(),
  resume: (v) => v.resume(),
  rollback: (v) => v.rollback(),
  reset: (v) => v.reset(),
};

export function MapFrame({ v, hero, traffic, envs, app, ai, canResume = true, canRollback = true }: MapFrameProps & { traffic?: TrafficState; envs?: Environment[]; app?: App; ai?: AIActivity; canResume?: boolean; canRollback?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const pending = useRef(false);
  const [height, setHeight] = useState(1240);
  const [ready, setReady] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const snap = buildMapSnapshot(v, { traffic, envs, app, now, hero, ai, aiMinutes: AI_MINUTES });
  if (!canResume) snap.actions = snap.actions.filter((a) => a.key !== "resume");
  if (!canRollback) snap.actions = snap.actions.filter((a) => a.key !== "rollback");
  const json = JSON.stringify(snap);

  // durations of the phase at work move with the clock
  const working = snap.phases.some((x) => x.st === "cur" || x.st === "wait");
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [working]);

  // the latest view and snapshot, for commands that arrive between renders
  const latest = useRef<{ v: MigrationView; snap: MapSnapshot }>({ v, snap });
  latest.current = { v, snap };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !frame.current || e.source !== frame.current.contentWindow) return;
      const d = e.data as { type?: string; h?: number; key?: MapAction } | null;
      if (d?.type === "hc-ready") setReady((n) => n + 1);
      else if (d?.type === "hc-height" && typeof d.h === "number" && Number.isFinite(d.h) && d.h > 0 && d.h <= 20000) setHeight(d.h);
      else if (d?.type === "hc-cmd" && d.key) {
        // only a command the current state offers, once: a stale frame cannot start what is no longer allowed
        const { v: cur, snap: s } = latest.current;
        if (!cur.busy && !pending.current && s.actions.some((a) => a.key === d.key)) {
          // held until the state the command produced reaches this page (a new snapshot), so a double
          // click in the frame between the command and React's next render runs the command once
          pending.current = true;
          RUN[d.key](cur);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    pending.current = false;
  }, [json]);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ type: "hc-snapshot", snap: JSON.parse(json) }, window.location.origin);
  }, [json, ready]);

  return (
    <iframe
      ref={frame}
      className="mapframe"
      src={MAP_SRC}
      title="이주 지도"
      scrolling="no"
      style={{ display: "block", width: "100%", height, border: 0, background: "transparent" }}
    />
  );
}
