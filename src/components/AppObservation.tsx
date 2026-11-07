// The observation popup of an app: how it is doing in words, a chart of the last hour or more, the services, the errors
// that repeat and what happened when. The numbers come from GET /v1/apps/{name}/observability (the logs HyperDX
// keeps), the deployments from the apps API. No log line is shown, only counts and redacted patterns.
import { useEffect, useId, useRef, useState } from "react";
import { useAppObservability, useDeployments } from "../api/hooks";
import type { AppObservation as Observation } from "../api/types";
import { agoText, num, summarize, timeline, windowLabel, WINDOWS, type ObserveLevel } from "../data/observe";
import { DeployChip } from "./deploy";
import { HyperDXLink } from "./HyperDXLink";
import { Chip, LoadError, Skeleton, type ChipKind } from "./ui";
import "../styles/app-observation.css";

const LEVEL: Record<ObserveLevel, [ChipKind, string]> = { none: ["neu", "로그 없음"], ok: ["ok", "정상"], warn: ["warn", "확인 필요"], bad: ["bad", "문제"] };

/** One bar a bucket; the red part is the errors, the amber part the warnings. */
export function Bars({ o }: { o: Observation }) {
  const max = Math.max(1, ...o.buckets.map((b) => b.total));
  if (o.buckets.length === 0) return <p className="hint">이 시간대에 그릴 로그가 없습니다.</p>;
  return (
    <div className="obs-bars" role="img" aria-label={`5분마다의 로그 수. 가장 많을 때 ${num(max)}건`}>
      {o.buckets.map((b) => {
        const h = (b.total / max) * 100;
        const e = b.total ? (b.errors / b.total) * 100 : 0;
        const w = b.total ? (b.warnings / b.total) * 100 : 0;
        return (
          <div key={b.time} className="obs-bar" title={`${new Date(b.time).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} · 로그 ${num(b.total)}건, 오류 ${b.errors}건, 경고 ${b.warnings}건`}>
            <div className="obs-col" style={{ height: h + "%" }}>
              {b.errors > 0 && <i className="e" style={{ height: Math.max(e, 8) + "%" }} />}
              {b.warnings > 0 && <i className="w" style={{ height: Math.max(w, 8) + "%" }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AppObservationDialog({ app, onClose }: { app: string; onClose: () => void }) {
  const [minutes, setMinutes] = useState(60);
  const [now, setNow] = useState(() => Date.now());
  const obs = useAppObservability(app, minutes, 15000);
  const deps = useDeployments(app, 0, 20);
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  // The page behind passes a new onClose on each render (it polls the apps); the effect below must not run again then,
  // or focus would jump back to the dialog every few seconds.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  // Esc closes; the page behind does not scroll while it is open; focus goes in and comes back
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const body = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = body;
      prev?.focus?.();
    };
  }, []);

  const o = obs.data;
  const sum = o ? summarize(o, minutes, now) : undefined;
  const events = o ? timeline(o, deps.data, minutes, now) : [];
  const status = obs.error as { status?: number; code?: string } | undefined;

  return (
    <div className="obs-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="obs-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={box}>
        <header>
          <div>
            <h2 id={titleId}>{app} 관측</h2>
            <p className="hint">HyperDX가 모은 이 앱의 로그를 요약했습니다. 로그 원문은 보이지 않고, 비밀로 보이는 값은 가려집니다.</p>
          </div>
          <button type="button" className="btn ghost" onClick={onClose}>
            닫기
          </button>
        </header>

        <div className="obs-windows" role="group" aria-label="보는 기간">
          {WINDOWS.map((w) => (
            <button key={w.minutes} type="button" className={"btn ghost" + (w.minutes === minutes ? " on" : "")} aria-pressed={w.minutes === minutes} onClick={() => setMinutes(w.minutes)}>
              최근 {w.label}
            </button>
          ))}
        </div>

        {obs.error ? (
          <LoadError
            title="관측 정보를 불러오지 못했습니다."
            error={status?.status === 503 ? "이 서버는 로그 저장소에 연결되어 있지 않습니다." : status?.status === 502 ? "로그 저장소(HyperDX)를 읽지 못했습니다. 잠시 뒤 다시 시도합니다." : String((obs.error as Error).message ?? obs.error)}
            retry={obs.reload}
          />
        ) : !o || !sum ? (
          <Skeleton box />
        ) : (
          <>
            <section className="obs-head" aria-label="요약">
              <Chip kind={LEVEL[sum.level][0]} dot>
                {LEVEL[sum.level][1]}
              </Chip>
              <div>
                <strong>{sum.headline}</strong>
                {sum.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            </section>

            <section aria-label="로그 수 변화">
              <h3>5분마다의 로그 수</h3>
              <Bars o={o} />
              <p className="hint obs-legend">
                <i className="e" /> 오류 <i className="w" /> 경고 · 막대에 마우스를 올리면 시각과 건수가 나옵니다
              </p>
            </section>

            <section aria-label="지금까지의 진행">
              <h3>이렇게 진행됐습니다</h3>
              {events.length === 0 ? (
                <p className="hint">최근 {windowLabel(minutes)} 동안 배포나 눈에 띄는 변화가 없습니다.</p>
              ) : (
                <ol className="obs-timeline">
                  {events.map((e) => (
                    <li key={e.kind + e.at + e.text}>
                      <time dateTime={new Date(e.at).toISOString()}>{agoText(e.at, now)}</time>
                      <span>{e.text}</span>
                      {e.deploy && <DeployChip s={e.deploy.status} />}
                      <span className="hint">{e.kind === "deploy" ? "배포 기록" : "로그"}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {o.services.length > 0 && (
              <section aria-label="서비스별">
                <h3>서비스별</h3>
                <table className="obs-table">
                  <thead>
                    <tr>
                      <th>서비스</th>
                      <th>로그</th>
                      <th>오류</th>
                      <th>경고</th>
                      <th>마지막</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.services.map((s) => (
                      <tr key={s.name}>
                        <td className="m">{s.name}</td>
                        <td>{num(s.total)}</td>
                        <td className={s.errors ? "bad" : undefined}>{num(s.errors)}</td>
                        <td>{num(s.warnings)}</td>
                        <td className="hint">{agoText(Date.parse(s.lastSeen), now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {o.patterns.length > 0 && (
              <section aria-label="반복되는 오류">
                <h3>반복되는 오류와 경고</h3>
                <p className="hint">같은 실패는 한 줄로 묶었습니다. 숫자는 #로, 비밀번호·토큰 같은 값은 «가림»으로 바뀝니다. 모든 비밀을 알아볼 수는 없습니다.</p>
                <p className="hint">횟수는 이 기간의 최근 오류와 경고 500줄 안에서 센 것입니다.</p>
                <ul className="obs-patterns">
                  {o.patterns.map((p) => (
                    <li key={p.severity + p.service + p.text}>
                      <Chip kind={p.severity === "error" ? "bad" : "warn"}>{p.severity === "error" ? "오류" : "경고"}</Chip>
                      <code>{p.text}</code>
                      <span className="hint">
                        {p.service} · {num(p.count)}번 · {agoText(Date.parse(p.lastSeen), now)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <footer className="hint">
          <HyperDXLink text={app} />
          <span>15초마다 새로 읽습니다.</span>
        </footer>
      </div>
    </div>
  );
}
