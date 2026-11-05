// The secrets section of a registered app's page (ADR 0019): the app-wide
// secrets, one instance's overrides on top of them, changes staged and saved
// with one PUT per scope, and the no-build redeploy that applies them.
//
// A value is fetched only when the operator asks for it (the show button, or
// loading the current value into the edit form) and lives only in component
// state or in the masked input's DOM property: it is never logged, put in a
// URL or an HTML attribute, or written to storage.
import { useEffect, useId, useRef, useState } from "react";
import type { AppInstance, AppSecretInfo, AppSecretsUpdate } from "../api/types";
import { REDEPLOY_WAIT, redeployState, type AppModel, type SubmitResult } from "../data/deploy";
import type { RevealResult, SecretsModel } from "../data/secrets";
import { navigate } from "../router";
import { MAX_SECRETS, MAX_SECRET_VALUE, secretNameError, secretValueError } from "../sim/secrets";
import { ago, short } from "./deploy";
import { Chip, Table, td, type Cell } from "./ui";

/** How long a shown or loaded value stays. */
const REVEAL_MS = 60_000;

interface Props {
  /** the app page's secrets, also what its overview summarizes (useLiveSecrets or useSimSecrets) */
  s: SecretsModel;
  m: AppModel;
  /** another action of the page is in flight */
  busy: boolean;
  setRedeploying(on: boolean): void;
}

/** The app overview's secrets card: how many there are, and the app-wide names. Names only, never a value. */
export function SecretsSummary({ s }: { s: SecretsModel }) {
  if (s.notConfigured) return <p className="hint">서버에 시크릿 키가 설정되어 있지 않습니다.</p>;
  if (!s.data) return <p className="hint">{s.error ? "시크릿을 불러오지 못했습니다: " + s.error : "불러오는 중"}</p>;
  const overrides = s.data.instances.reduce((n, x) => n + x.secrets.length, 0);
  return (
    <>
      <p>
        앱 공통 {s.data.app.length}개, 인스턴스 덮어쓰기 {overrides}개
      </p>
      {s.data.app.length > 0 && <p className="hint m">{s.data.app.map((x) => x.name).join(", ")}</p>}
    </>
  );
}

/** One name in a scope: its own secret there, and for an instance the app-wide one it overrides or inherits. */
interface Row {
  name: string;
  own?: AppSecretInfo;
  inherited?: AppSecretInfo;
}

/** Which add form is open: the app-wide one, the picked instance's, or none. */
type Adding = "" | "app" | "instance";

export function AppSecrets({ s, m, busy, setRedeploying }: Props) {
  const [picked, setPicked] = useState("");
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState<Adding>("");
  const openers = { app: useRef<HTMLButtonElement>(null), instance: useRef<HTMLButtonElement>(null) };
  const pickId = useId();
  const selected = m.instances.find((i) => i.name === picked) ?? m.instances[0];
  /** Closes the open add form; `refocus` puts focus back on the button that opened it (the form's own close button goes away). */
  function closeAdd(refocus: boolean) {
    if (refocus && adding) openers[adding].current?.focus();
    setAdding("");
  }
  const shared = { s, m, busy, setRedeploying, onAddClose: closeAdd };
  const toggle = (a: Exclude<Adding, "">) => setAdding((x) => (x === a ? "" : a));
  const retry = (
    <div className="actrow">
      <button type="button" className="btn ghost" onClick={s.reload}>
        다시 불러오기
      </button>
    </div>
  );

  let body;
  if (s.notConfigured) {
    body = (
      <div className="box fillbox">
        <div className="bb">
          <p>서버에 시크릿 키가 설정되어 있지 않습니다. 플랫폼 API에 PLATFORM_SECRETS_KEY를 넣으면 쓸 수 있습니다.</p>
          {retry}
        </div>
      </div>
    );
  } else if (!s.data) {
    body = s.error ? (
      <>
        <p className="hint">시크릿을 불러오지 못했습니다: {s.error}</p>
        {retry}
      </>
    ) : (
      <p className="hint">불러오는 중</p>
    );
  } else {
    const app = s.data.app;
    const own = s.data.instances.find((x) => x.instance === selected?.name)?.secrets ?? [];
    const names = [...new Set([...app, ...own].map((x) => x.name))].sort();
    body = (
      <>
        <div className="sc-top">
          {selected && (
            <div className="field">
              <label htmlFor={pickId}>덮어쓰기를 볼 인스턴스</label>
              <select id={pickId} value={selected.name} disabled={dirty} onChange={(e) => setPicked(e.target.value)}>
                {m.instances.map((i) => (
                  <option key={i.name} value={i.name}>
                    {i.name} ({i.default ? "기본, " : ""}
                    {i.branch} 브랜치)
                  </option>
                ))}
              </select>
              <small>{dirty ? "저장하거나 취소한 뒤 다른 인스턴스를 고를 수 있습니다." : "인스턴스는 앱 공통 시크릿을 받고, 덮어쓴 이름만 그 인스턴스의 값을 씁니다."}</small>
            </div>
          )}
          {s.canEdit && (
            <div className="actrow">
              {selected && (
                <button ref={openers.instance} type="button" className="btn ghost" aria-expanded={adding === "instance"} onClick={() => toggle("instance")}>
                  덮어쓰기 추가
                </button>
              )}
              <button ref={openers.app} type="button" className="btn primary" aria-expanded={adding === "app"} onClick={() => toggle("app")}>
                시크릿 추가
              </button>
            </div>
          )}
        </div>
        {!s.canEdit && <p className="hint">이 계정의 역할로는 이름만 볼 수 있습니다. 값을 보거나 바꾸려면 operator 역할이 필요합니다.</p>}
        {selected && (
          <SecretScope
            {...shared}
            key={selected.name}
            instance={selected.name}
            label="인스턴스별 덮어쓰기"
            title={selected.name + "이(가) 받는 시크릿"}
            note="앱 공통 값 위에 덮어쓰기를 얹은 것"
            rows={names.map((name) => ({ name, own: own.find((x) => x.name === name), inherited: app.find((x) => x.name === name) }))}
            targets={[selected]}
            adding={adding === "instance"}
            onDirty={setDirty}
          />
        )}
        <SecretScope
          {...shared}
          label="앱 공통 시크릿"
          title="앱 공통 시크릿"
          note="모든 인스턴스가 받는 원본"
          rows={app.map((x) => ({ name: x.name, own: x }))}
          targets={m.instances}
          adding={adding === "app"}
        />
      </>
    );
  }
  return (
    <div className="ad-stack">
      {body}
      <p className="hint">
        앱에 환경 변수로 넣는 비밀 값입니다. 서버가 암호화해 보관하고, 보기를 누를 때만 값을 불러와 {REVEAL_MS / 1000}초 동안 보여 줍니다. platform.yaml의 env와 이름이 같으면 시크릿이
        이깁니다.
      </p>
      {!s.live && <p className="hint">데모 모드: 가짜 값이며 이 브라우저 탭의 메모리에만 있습니다. 서버에는 요청하지 않습니다.</p>}
    </div>
  );
}

/* ---------- shown values ---------- */

/** Calls `onExpire` once REVEAL_MS has passed since `since` (epoch ms; 0 is off). Runs on an interval and Date.now, so tests can fake just those. */
function useExpiry(since: number, onExpire: (now: number) => void) {
  const cb = useRef(onExpire);
  useEffect(() => {
    cb.current = onExpire;
  });
  useEffect(() => {
    if (!since) return;
    const t = setInterval(() => cb.current(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
}

/**
 * The values on screen, by name. They live only in this state: hiding one,
 * leaving the page or the instance (unmount) and REVEAL_MS after it was shown
 * drop it.
 */
function useShown(fetchValue: (name: string, signal: AbortSignal) => Promise<RevealResult>, onError: (message: string) => void) {
  const [shown, setShown] = useState<ReadonlyMap<string, { value: string; at: number }>>(() => new Map());
  const [loading, setLoading] = useState<readonly string[]>([]);
  const ctrls = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const c = ctrls.current;
    return () => c.forEach((x) => x.abort());
  }, []);
  const oldest = Math.min(...[...shown.values()].map((v) => v.at));
  useExpiry(shown.size > 0 ? oldest : 0, (now) =>
    setShown((m) => {
      const keep = [...m].filter(([, v]) => now - v.at < REVEAL_MS);
      return keep.length === m.size ? m : new Map(keep);
    }),
  );

  const stopLoading = (name: string) => setLoading((l) => l.filter((x) => x !== name));
  function hide(name: string) {
    ctrls.current.get(name)?.abort();
    ctrls.current.delete(name);
    stopLoading(name);
    setShown((m) => {
      if (!m.has(name)) return m;
      const next = new Map(m);
      next.delete(name);
      return next;
    });
  }
  async function show(name: string) {
    ctrls.current.get(name)?.abort();
    const ctrl = new AbortController();
    ctrls.current.set(name, ctrl);
    setLoading((l) => [...l, name]);
    const r = await fetchValue(name, ctrl.signal);
    if (ctrl.signal.aborted) return;
    ctrls.current.delete(name);
    stopLoading(name);
    if ("value" in r) setShown((m) => new Map(m).set(name, { value: r.value, at: Date.now() }));
    else onError(r.error);
  }
  return {
    value: (name: string) => shown.get(name)?.value,
    isShown: (name: string) => shown.has(name),
    isLoading: (name: string) => loading.includes(name),
    toggle: (name: string) => (shown.has(name) ? hide(name) : void show(name)),
    hide,
    clear() {
      ctrls.current.forEach((x) => x.abort());
      ctrls.current.clear();
      setLoading([]);
      setShown(new Map());
    },
  };
}

/* ---------- one scope: the app-wide secrets, or one instance's overrides ---------- */

/** A staged change of one name: a value to set, or a delete. */
type Change = { value: string } | { remove: true };

/** What a staged change does, for its chip and the summary. */
function changeLabel(row: Row | undefined, c: Change): string {
  if ("remove" in c) return row?.inherited ? "덮어쓰기 지우기" : "삭제";
  if (row?.own) return "수정";
  return row?.inherited ? "덮어쓰기" : "추가";
}

interface RedeployLine {
  instance: string;
  r: SubmitResult;
}

interface ScopeProps {
  s: SecretsModel;
  m: AppModel;
  busy: boolean;
  setRedeploying(on: boolean): void;
  /** the overrides of this instance; app-wide without it */
  instance?: string;
  /** the region's accessible name */
  label: string;
  title: string;
  note: string;
  rows: Row[];
  /** the instances to offer a redeploy after a save */
  targets: AppInstance[];
  /** the add form is open */
  adding: boolean;
  /** Closes the add form; `refocus` returns focus to the button that opened it. */
  onAddClose(refocus: boolean): void;
  onDirty?(dirty: boolean): void;
}

function SecretScope(p: ScopeProps) {
  const { s, m, instance, onDirty } = p;
  const [changes, setChanges] = useState<ReadonlyMap<string, Change>>(() => new Map());
  /** the name being edited; one form at a time, so it and the add form close each other */
  const [editing, setEditingName] = useState("");
  const [wasAdding, setWasAdding] = useState(p.adding);
  if (p.adding !== wasAdding) {
    setWasAdding(p.adding);
    if (p.adding) setEditingName("");
  }
  function setEditing(name: string) {
    if (name && p.adding) p.onAddClose(false);
    setEditingName(name);
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [lines, setLines] = useState<RedeployLine[]>([]);
  const shown = useShown(
    (name, signal) => s.reveal(name, instance, signal),
    (e) => setError("값을 불러오지 못했습니다: " + e),
  );
  const dirty = changes.size > 0;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  // Names only from now on (a 403): nothing staged can be saved, and nothing shown may stay.
  const canEdit = s.canEdit;
  const clearShown = shown.clear;
  useEffect(() => {
    if (canEdit) return;
    setChanges(new Map());
    setEditing("");
    clearShown();
    // Only on the switch to names only; clearShown is a new function every render.
  }, [canEdit]);

  const byName = new Map(p.rows.map((r) => [r.name, r]));
  // Where focus goes after the control that had it disappears (a row's buttons, the form, the pending bar).
  const root = useRef<HTMLElement>(null);
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const sel = focusNext.current;
    if (!sel) return;
    focusNext.current = null;
    const el = root.current?.querySelector<HTMLElement>(sel) ?? root.current?.querySelector<HTMLElement>("input:not([disabled])") ?? root.current?.querySelector<HTMLElement>("button:not([disabled])");
    el?.focus();
  });
  const focusButton = (label: string) => (focusNext.current = `button[aria-label="${label}"]`);
  /** The row's button that opens its form, after a revert or a closed form; a staged new name has none. */
  const focusRow = (name: string) => {
    const r = byName.get(name);
    focusNext.current = r?.own || r?.inherited ? `button[aria-label="${name} ${r.own ? "수정" : "덮어쓰기"}"]` : "input:not([disabled])";
  };

  const rows: Row[] = [...p.rows, ...[...changes.keys()].filter((n) => !byName.has(n)).sort().map((name) => ({ name }))];
  const what = instance ? instance + "의 덮어쓰기" : "앱 공통 시크릿";
  /** `what` with its object particle */
  const whatObj = instance ? what + "를" : what + "을";

  function stage(name: string, c: Change) {
    shown.hide(name);
    setChanges((x) => new Map(x).set(name, c));
    setEditing("");
    setSaved(false);
    setLines([]);
    setError("");
  }
  function revert(name: string) {
    setChanges((x) => {
      const next = new Map(x);
      next.delete(name);
      return next;
    });
    focusRow(name);
  }
  function cancel() {
    setChanges(new Map());
    setEditing("");
    setError("");
    focusNext.current = "input:not([disabled])";
  }
  /** Why one more secret does not fit in this scope; "" when it does. */
  function full(): string {
    const added = [...changes].filter(([n, c]) => !("remove" in c) && !byName.get(n)?.own).length;
    const removed = [...changes.values()].filter((c) => "remove" in c).length;
    const own = p.rows.filter((r) => r.own).length;
    return own + added - removed >= MAX_SECRETS ? "시크릿은 " + (instance ? "인스턴스마다 " : "") + MAX_SECRETS + "개까지입니다" : "";
  }
  /** Why `name` cannot be added here; "" when it can. */
  function taken(name: string): string {
    if (changes.has(name)) return "이미 변경에 넣은 이름입니다. 목록에서 되돌린 뒤 다시 넣으세요";
    if (byName.get(name)?.own) return (instance ? "이미 덮어쓴 이름입니다" : "이미 있는 이름입니다") + ". 목록에서 수정을 누르세요";
    return full();
  }
  async function save() {
    const sent = changes;
    const set: Record<string, string> = {};
    const remove: string[] = [];
    for (const [n, c] of sent) {
      if ("remove" in c) remove.push(n);
      else set[n] = c.value;
    }
    const body: AppSecretsUpdate = { ...(instance ? { instance } : {}), ...(Object.keys(set).length ? { set } : {}), ...(remove.length ? { delete: remove } : {}) };
    setSaving(true);
    setError("");
    const err = await s.save(body);
    setSaving(false);
    if (err) return setError("저장하지 못했습니다: " + err);
    // Only what went out: the controls wait during a save, but a change made meanwhile must not vanish.
    setChanges((x) => {
      const next = new Map(x);
      for (const [n, c] of sent) if (next.get(n) === c) next.delete(n);
      return next;
    });
    setEditing("");
    shown.clear();
    setLines([]);
    setSaved(true);
    focusNext.current = ".ad-part.ok";
  }

  const appName = m.app?.name ?? "";
  const state = (i: AppInstance) => redeployState(appName, i, m.deployments);
  async function redeploy(list: AppInstance[]) {
    const waiting = list.filter((i) => state(i).running);
    const go = list.filter((i) => !state(i).running);
    p.setRedeploying(true);
    try {
      const out: RedeployLine[] = [
        ...(await Promise.all(go.map(async (i) => ({ instance: i.name, r: await m.redeployNoBuild(i.branch) })))),
        ...waiting.map((i) => ({ instance: i.name, r: { error: REDEPLOY_WAIT } })),
      ];
      // A lone instance goes to its deployment like the deploy button; with several, the others' buttons stay here.
      if (p.targets.length === 1 && out.length === 1 && "deploymentId" in out[0].r) navigate("#deploy-" + out[0].r.deploymentId);
      else setLines((prev) => [...prev.filter((l) => !out.some((o) => o.instance === l.instance)), ...out]);
    } finally {
      p.setRedeploying(false);
    }
  }

  const head = ["이름", ...(canEdit ? ["값"] : []), ...(instance ? ["출처"] : []), "바꾼 때", ...(canEdit ? [""] : [])];
  const table = rows.map((r) => {
    const c = changes.get(r.name);
    const cells: Cell[] = [
      td(
        <span className="chips">
          <span className="m">{r.name}</span>
          {c && <Chip>{changeLabel(r, c)} 예정</Chip>}
        </span>,
      ),
    ];
    if (canEdit) {
      const v = shown.value(r.name);
      cells.push(
        td(
          !r.own ? (
            <span className="hint">{r.inherited ? "앱 공통 값" : "-"}</span>
          ) : v !== undefined ? (
            <span className="m" style={{ overflowWrap: "anywhere" }}>
              {v}
            </span>
          ) : (
            <span className="m" role="img" aria-label="가려진 값">
              ••••••••
            </span>
          ),
        ),
      );
    }
    if (instance) cells.push(td(r.own ? <Chip>{r.inherited ? "덮어씀" : "이 인스턴스만"}</Chip> : r.inherited ? <span className="hint">앱 공통</span> : "-", "nw"));
    cells.push(td(r.own ? ago(r.own.updatedAt, s.now) + ", " + r.own.updatedBy : "-", "nw"));
    if (canEdit) {
      const btn = (text: string, onClick: () => void) => (
        <button type="button" className="btn ghost" aria-label={r.name + " " + text} disabled={saving} onClick={onClick}>
          {text}
        </button>
      );
      cells.push(
        td(
          <div className="actrow">
            {c ? (
              btn("되돌리기", () => revert(r.name))
            ) : r.own ? (
              <>
                <button
                  type="button"
                  className="btn ghost"
                  aria-label={r.name + " 값 보기"}
                  aria-pressed={shown.isShown(r.name)}
                  disabled={shown.isLoading(r.name)}
                  onClick={() => {
                    setError("");
                    shown.toggle(r.name);
                  }}
                >
                  보기
                </button>
                {btn("수정", () => setEditing(r.name))}
                {btn(r.inherited ? "덮어쓰기 지우기" : "삭제", () => {
                  stage(r.name, { remove: true });
                  focusButton(r.name + " 되돌리기");
                })}
              </>
            ) : (
              r.inherited && btn("덮어쓰기", () => setEditing(r.name))
            )}
          </div>,
          "nw",
        ),
      );
    }
    return cells;
  });

  const row = editing ? byName.get(editing) : undefined;
  const waiting = p.targets.filter((i) => state(i).running);
  // One card: the table, then the open form, the staged changes, an error and the save result as parts of it.
  return (
    <section className="box" aria-label={p.label} ref={root}>
      <div className="bh">
        <h2>{p.title}</h2>
        <span className="hint">{p.note}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="hint">{instance ? "앱 공통 시크릿도 덮어쓰기도 없습니다." : "아직 시크릿이 없습니다."}</p>
        </div>
      ) : (
        <Table head={head} rows={table} />
      )}
      {canEdit &&
        (row ? (
          <SecretForm
            key={"edit:" + editing}
            name={editing}
            title={editing + (row.own ? " 값 바꾸기" : " 덮어쓰기")}
            loadLabel={row.own ? "현재 값 불러오기" : "앱 공통 값 불러오기"}
            load={(signal) => s.reveal(editing, row.own ? instance : undefined, signal)}
            check={row.own ? undefined : full}
            disabled={saving}
            onStage={(name, value) => {
              stage(name, { value });
              focusButton(name + " 되돌리기");
            }}
            onClose={() => {
              setEditing("");
              focusRow(editing);
            }}
          />
        ) : (
          p.adding && (
            <SecretForm
              key="add"
              title={instance ? "이 인스턴스에 덮어쓰기 추가" : "시크릿 추가"}
              check={taken}
              disabled={saving}
              onStage={(name, value) => stage(name, { value })}
              onClose={() => p.onAddClose(true)}
            />
          )
        ))}
      {canEdit && dirty && (
        <div className="ad-part fill" role="status">
          <div className="actrow">
            <b>저장하지 않은 변경 {changes.size}개</b>
            <span className="hint">{[...changes].map(([n, c]) => n + " " + changeLabel(byName.get(n), c)).join(", ")}</span>
          </div>
          <p className="hint">저장을 눌러야 서버에 보냅니다. {whatObj} 한 번에 바꿉니다.</p>
          <div className="actrow">
            <button type="button" className="btn primary" disabled={saving} onClick={save}>
              {saving ? "저장하는 중" : "저장"}
            </button>
            <button type="button" className="btn ghost" disabled={saving} onClick={cancel}>
              취소
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="ad-part bad" role="alert">
          <p>{error}</p>
        </div>
      )}
      {saved && (
        <div className="ad-part ok" role="status" tabIndex={-1}>
          <b>{whatObj} 저장했습니다.</b>
          <p>
            실행 중인 {instance ? "인스턴스는" : "인스턴스들은"} 재배포할 때까지 이전 값을 씁니다. 재배포는 빌드하지 않고 마지막 정상 배포(괄호 안의 커밋)를 지금 시크릿으로 다시
            배포합니다.
          </p>
          <div className="actrow">
            {p.targets.map((i) => {
              const st = state(i);
              return (
                <button key={i.name} type="button" className="btn" disabled={p.busy || st.running} onClick={() => redeploy([i])}>
                  {i.name} 재배포{st.commit ? " (" + short(st.commit) + ")" : ""}
                </button>
              );
            })}
            {p.targets.length > 1 && (
              <button type="button" className="btn primary" disabled={p.busy || waiting.length === p.targets.length} onClick={() => redeploy(p.targets)}>
                모든 인스턴스 재배포
              </button>
            )}
          </div>
          {waiting.length > 0 && (
            <p className="hint">
              {waiting.map((i) => i.name).join(", ")}: {REDEPLOY_WAIT}.
            </p>
          )}
          {lines.length > 0 && (
            <ul className="rows">
              {lines.map(({ instance: name, r }) => (
                <li key={name}>
                  <b className="m">{name}</b>
                  <span className="grow">{"deploymentId" in r ? "재배포를 시작했습니다." : "error" in r ? r.error : "platform.yaml이 규칙에 맞지 않습니다."}</span>
                  {"deploymentId" in r && (
                    <a href={"#deploy-" + r.deploymentId} aria-label={name + " 재배포 진행 보기"}>
                      진행 보기
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- the add and edit form ---------- */

interface FormProps {
  /** the name whose value is changed; the add form asks for one */
  name?: string;
  title: string;
  loadLabel?: string;
  /** fetches the value to start from */
  load?: (signal: AbortSignal) => Promise<RevealResult>;
  /** why the name (new, or a new override) cannot be staged; "" when it can */
  check?(name: string): string;
  /** a save is in flight */
  disabled: boolean;
  onStage(name: string, value: string): void;
  onClose?(): void;
}

/**
 * The value input is uncontrolled: React would mirror a controlled value into
 * the HTML value attribute. It is masked unless its own show button is
 * pressed, and a loaded value nobody edited is cleared after REVEAL_MS.
 */
function SecretForm(p: FormProps) {
  const [name, setName] = useState("");
  const [errs, setErrs] = useState<{ name?: string; value?: string }>({});
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  /** epoch ms of a loaded value not edited since; 0 when there is none */
  const [loadedAt, setLoadedAt] = useState(0);
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => {
    const el = input.current;
    return () => {
      ctrl.current?.abort();
      if (el) el.value = "";
    };
  }, []);
  useExpiry(loadedAt, (now) => {
    if (now - loadedAt < REVEAL_MS || !input.current) return;
    input.current.value = "";
    setLoadedAt(0);
    setVisible(false);
    setNote("불러온 값은 " + REVEAL_MS / 1000 + "초가 지나 지웠습니다. 다시 불러오거나 새 값을 넣으세요.");
  });
  const id = useId();
  const valueLabel = p.name ? p.name + " 새 값" : "값";

  async function load() {
    ctrl.current?.abort();
    const c = (ctrl.current = new AbortController());
    setLoading(true);
    const r = await p.load!(c.signal);
    if (c.signal.aborted) return;
    setLoading(false);
    if ("value" in r && input.current) {
      input.current.value = r.value;
      setLoadedAt(Date.now());
      setNote("");
      setErrs({});
    } else if ("error" in r) setErrs({ value: "값을 불러오지 못했습니다: " + r.error });
  }
  function submit() {
    const n = p.name ?? name.trim();
    const value = input.current?.value ?? "";
    const extra = p.check?.(n) ?? "";
    const e = p.name ? { value: secretValueError(value) || extra } : { name: secretNameError(n) || extra, value: secretValueError(value) };
    if (e.name || e.value) return setErrs(e);
    p.onStage(n, value);
    setName("");
    if (input.current) input.current.value = "";
    setLoadedAt(0);
    setVisible(false);
    setErrs({});
  }
  const err = (text: string | undefined) =>
    text ? (
      <span className="entry-err" role="alert">
        {text}
      </span>
    ) : null;
  return (
    <div className="ad-part">
      <div className="ad-formh">
        <b>{p.title}</b>
        <span className="hint">저장을 누르기 전에는 서버에 보내지 않습니다</span>
      </div>
      <div className="form">
        {!p.name && (
          <div className="field">
            <label htmlFor={id + "n"}>이름</label>
            <input
              id={id + "n"}
              value={name}
              disabled={p.disabled}
              spellCheck={false}
              autoComplete="off"
              autoFocus
              aria-invalid={!!errs.name}
              aria-describedby={id + "nm"}
              onChange={(e) => {
                setName(e.target.value);
                setErrs((x) => ({ ...x, name: "" }));
              }}
            />
            <small id={id + "nm"}>{err(errs.name) ?? "영문 대문자, 숫자, _로 64자까지. 예: HOST_CODE"}</small>
          </div>
        )}
        <div className="field">
          <label htmlFor={id + "v"}>{valueLabel}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={input}
              id={id + "v"}
              type={visible ? "text" : "password"}
              disabled={p.disabled}
              autoComplete="new-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              autoFocus={!!p.name}
              aria-invalid={!!errs.value}
              aria-describedby={id + "vm"}
              onChange={() => {
                // edited: the operator's own input now, so it no longer expires
                setLoadedAt(0);
                setNote("");
                setErrs((x) => ({ ...x, value: "" }));
              }}
            />
            <button type="button" className="btn ghost" aria-label="입력한 값 보기" aria-pressed={visible} disabled={p.disabled} onClick={() => setVisible((v) => !v)}>
              보기
            </button>
          </div>
          <small id={id + "vm"}>
            {err(errs.value) ?? (note || MAX_SECRET_VALUE + "바이트까지." + (p.name ? " 새 값을 넣거나 지금 값을 불러와 고치세요." : ""))}
          </small>
        </div>
      </div>
      <div className="actrow">
        <button type="button" className="btn" disabled={p.disabled} onClick={submit}>
          변경에 넣기
        </button>
        {p.load && (
          <button type="button" className="btn ghost" disabled={p.disabled || loading} onClick={load}>
            {loading ? "불러오는 중" : p.loadLabel}
          </button>
        )}
        {p.onClose && (
          <button type="button" className="btn ghost" disabled={p.disabled} onClick={p.onClose}>
            닫기
          </button>
        )}
      </div>
    </div>
  );
}
