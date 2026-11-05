import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
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
/** `cls` "num": a number (count, duration, rate), in fixed-width digits and right-aligned; "m": an ID, commit or host in mono. */
export const td = (v: ReactNode, cls?: string): Cell => ({ v, cls });

const isNum = (c: Cell | undefined) => !!c?.cls?.split(" ").includes("num");

export function Table({ head, rows }: { head: string[]; rows: Cell[][] }) {
  // a column of numbers aligns its head with them
  const num = head.map((_, i) => rows.length > 0 && rows.every((r) => isNum(r[i])));
  return (
    <div className="scroll">
      <table className="tbl">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={num[i] ? "num" : undefined}>
                {h}
              </th>
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

type TabsProps = { label: string; items: TabItem[]; current: string } & (
  | { hrefOf: (id: string) => string; onSelect?: never; idBase?: never }
  | { onSelect: (id: string) => void; idBase: string; hrefOf?: never }
);

/** ids that tie an in-page tab to its panel: give the panel `id={tabPanelId(idBase, id)}` and `aria-labelledby={tabId(idBase, id)}`. */
export const tabId = (base: string, id: string) => base + "-tab-" + id;
export const tabPanelId = (base: string, id: string) => base + "-panel-" + id;

/**
 * A row of tabs.
 * - `hrefOf`: each tab is a link (route tabs, so back works and a tab opens by hash).
 * - `onSelect` + `idBase`: an in-page tablist following the ARIA tabs pattern (one tab in the Tab order,
 *   arrow keys, Home and End move and select); the caller renders the panel with `tabPanelId`.
 */
export function Tabs(p: TabsProps) {
  const { label, items, current } = p;
  if (p.hrefOf) {
    const hrefOf = p.hrefOf;
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
  const { onSelect, idBase } = p;
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((t) => t.id === current);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = items[(next + items.length) % items.length];
    onSelect(t.id);
    document.getElementById(tabId(idBase, t.id))?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={move}>
      {items.map((t) => (
        <button
          key={t.id}
          id={tabId(idBase, t.id)}
          type="button"
          role="tab"
          className="tab"
          aria-selected={t.id === current}
          aria-controls={tabPanelId(idBase, t.id)}
          tabIndex={t.id === current ? 0 : -1}
          onClick={() => onSelect(t.id)}
        >
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
