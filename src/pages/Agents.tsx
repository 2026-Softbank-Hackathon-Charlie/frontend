import { useEffect, useMemo, useRef, useState } from "react";
import { useAgentSession, useAgentSessions, useApps, useRuns } from "../api/hooks";
import type { AgentEvent, AgentSession } from "../api/types";
import { BlockedTable, SessionFeed, SessionTable } from "../components/agent";
import { LoadError, PageHead, Skeleton } from "../components/ui";
import { errorText, useLive, usePlans } from "../data/live";
import { sessionContext, type SessionContext } from "../data/agentContext";
import { fmt } from "../sim/format";
import { allSessions } from "../sim/mig";
import { useSim } from "../sim/store";

export function Agents() {
  return useLive() ? <LiveAgents /> : <SimAgents />;
}

function SimAgents() {
  const { S } = useSim();
  const [picked, setPicked] = useState<string | null>(null);
  const all = allSessions(S.mig);
  return <AgentsView sessions={all.sessions} picked={picked} onPick={setPicked} eventsOf={(id) => all.events[id] ?? []} />;
}

function LiveAgents() {
  const list = useAgentSessions(5_000, { limit: 50 });
  const linked = !!list.data?.some(session => session.planRef || session.runId);
  const plans = usePlans(0, linked), runs = useRuns(0, linked), apps = useApps(0, linked);
  const refs = [...new Set(list.data?.flatMap(s => [s.planRef ? "p:" + s.planRef : "", s.runId ? "r:" + s.runId : ""]).filter(Boolean) ?? [])].sort().join("|");
  const seen = useRef<string | undefined>(undefined);
  // Reuse the three loaded lists for all rows and unchanged session polls.
  // Only newly linked records or an explicit retry reload their metadata.
  useEffect(() => {
    if (!linked) return;
    if (seen.current === undefined) { seen.current = refs; return; }
    if (seen.current === refs) return;
    seen.current = refs;
    plans.reload(); runs.reload(); apps.reload();
  }, [linked, refs, plans.reload, runs.reload, apps.reload]);
  const contexts = useMemo(() => new Map(list.data?.map(s => [s.id, sessionContext(s, plans.data ?? [], runs.data ?? [], apps.data ?? [])]) ?? []), [list.data, plans.data, runs.data, apps.data]);
  const missing = linked ? [plans.error && "계획", runs.error && "실행", apps.error && "앱"].filter(Boolean) : [];
  const [picked, setPicked] = useState<string | null>(null);
  const id = picked ?? list.data?.[0]?.id ?? null;
  const watch = useAgentSession(id);
  return (
    <AgentsView
      sessions={list.data ?? []}
      picked={id}
      onPick={setPicked}
      eventsOf={(x) => (x === id ? watch.events : [])}
      error={list.error && !list.data ? errorText(list.error) : undefined}
      retry={list.reload}
      loading={list.loading}
      contexts={contexts}
      contextError={missing.length ? "맥락 조회 실패: " + missing.join(" · ") : undefined}
      retryContext={() => { plans.reload(); runs.reload(); apps.reload(); }}
    />
  );
}

function AgentsView({
  sessions,
  picked,
  onPick,
  eventsOf,
  error,
  retry,
  loading,
  contexts = new Map(),
  contextError,
  retryContext,
}: {
  sessions: AgentSession[];
  picked: string | null;
  onPick: (id: string) => void;
  eventsOf: (id: string) => AgentEvent[];
  error?: string;
  retry?: () => void;
  loading?: boolean;
  contexts?: ReadonlyMap<string, SessionContext>;
  contextError?: string;
  retryContext?: () => void;
}) {
  const shown = sessions.find((s) => s.id === picked) ?? sessions[0];
  const tokens = sessions.reduce((a, s) => [a[0] + s.totals.inputTokens, a[1] + s.totals.outputTokens], [0, 0]);
  return (
    <div className="page">
      <PageHead icon="bot" title="AI 활동" />
      {error ? (
        <LoadError title="AI 세션을 불러오지 못했습니다." error={error} retry={retry} />
      ) : loading ? (
        <Skeleton box />
      ) : sessions.length === 0 ? (
        <div className="box">
          <div className="empty-state">
            <b>AI 세션이 아직 없습니다.</b>
            <p className="hint">이전 화면에서 AI 계획을 시작하면 계획, 리허설, 진단 세션이 여기에 쌓입니다.</p>
            <a className="btn primary" href="#migrate-app">
              이전 화면으로
            </a>
          </div>
        </div>
      ) : (
        <>
          <p className="hint">
            세션 {sessions.length}개, 토큰 입력 {fmt(tokens[0])} / 출력 {fmt(tokens[1])}
          </p>
          <div className="box">
            {contextError && <div className="bb"><p role="alert" className="hint">{contextError}. 연결되지 않은 값은 미확인으로 표시합니다.</p><button type="button" className="btn ghost sm" onClick={retryContext}>맥락 다시 읽기</button></div>}
            <SessionTable sessions={sessions} onPick={onPick} picked={shown?.id} contexts={contexts} />
          </div>
          {shown && (
            <div className="split">
              <SessionFeed s={shown} events={eventsOf(shown.id)} />
              <BlockedTable events={eventsOf(shown.id)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
