import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { StepState } from "../sim/format";
import type { LogLine } from "../sim/state";

/** "" and "neu" are the same neutral grey; "warn" waits on a person (approval, switch). */
export type ChipKind = "" | "neu" | "ok" | "bad" | "run" | "warn";

/** Status label: a flat tint, never outlined, so it does not read as a button. `dot` adds a leading dot for headline states. */
export function Chip({ kind = "", dot, children }: { kind?: ChipKind; dot?: boolean; children: ReactNode }) {
  return (
    <span className={"chip" + (kind ? " " + kind : "")}>
      {dot && <span className="dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Square status indicator. Purely decorative: the adjacent text always carries the state. */
export function Ind({ st }: { st: StepState }) {
  return (
    <span className={"ind " + st} aria-hidden="true">
      {st === "run" && (
        <svg viewBox="0 0 16 16">
          <circle className="track" cx="8" cy="8" r="6.5" />
          <circle className="arc" cx="8" cy="8" r="6.5" />
        </svg>
      )}
    </span>
  );
}

/**
 * Monospace log that stays scrolled to the newest line without moving focus.
 * `follow={false}` stops that; `mark` highlights one line and scrolls to it instead.
 */
export function LogBox({ lines, empty = "아직 기록이 없습니다.", follow = true, mark }: { lines: LogLine[]; empty?: string; follow?: boolean; mark?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const line = mark === undefined ? undefined : (el.children[mark] as HTMLElement | undefined);
    if (line) el.scrollTop += line.getBoundingClientRect().top - el.getBoundingClientRect().top - 24;
    else if (follow) el.scrollTop = el.scrollHeight;
  }, [lines.length, follow, mark]);
  return (
    <div className="log" ref={ref} role="log" aria-live="off">
      {lines.length === 0 ? (
        <div className="empty">{empty}</div>
      ) : (
        lines.map((l, i) => (
          <div key={i} className={i === mark ? "err" : undefined}>
            <time>{l[0]}</time>
            {l[1]}
          </div>
        ))
      )}
    </div>
  );
}

export interface Cell {
  v: ReactNode;
  cls?: string;
}
export const td = (v: ReactNode, cls?: string): Cell => ({ v, cls });

export function Table({ head, rows }: { head: string[]; rows: Cell[][] }) {
  return (
    <div className="scroll">
      <table className="tbl">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={c.cls}>
                  {c.v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PageHead({ title, sub, acts, crumb }: { title: ReactNode; sub?: ReactNode; acts?: ReactNode; crumb?: ReactNode }) {
  return (
    <div className="ph">
      <div>
        {crumb && <div className="crumb">{crumb}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {acts && <div className="acts">{acts}</div>}
    </div>
  );
}

export interface TabItem {
  id: string;
  label: ReactNode;
}

/**
 * A row of tabs. With `hrefOf` each tab is a link (route tabs, so back works and tests can open a tab by hash);
 * otherwise each is a role="tab" button that calls `onSelect`. The caller renders the panel.
 */
export function Tabs({ label, items, current, onSelect, hrefOf }: { label: string; items: TabItem[]; current: string; onSelect?: (id: string) => void; hrefOf?: (id: string) => string }) {
  if (hrefOf) {
    return (
      <nav className="tabs" aria-label={label}>
        {items.map((t) => (
          <a key={t.id} className="tab" href={hrefOf(t.id)} aria-current={t.id === current ? "page" : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
    );
  }
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button key={t.id} type="button" role="tab" className="tab" aria-selected={t.id === current} onClick={() => onSelect?.(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ProgItem({ st, title, sub, right }: { st: StepState; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <li>
      <Ind st={st} />
      <div>
        <b>{title}</b>
        {sub && <small>{sub}</small>}
      </div>
      <span className="t">{right}</span>
    </li>
  );
}
