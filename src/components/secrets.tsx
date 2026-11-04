// The secrets section of a registered app's page (ADR 0019): the app-wide
// secrets, one instance's overrides on top of them, changes staged and saved
// with one PUT per scope, and the no-build redeploy that applies them.
//
// A value is fetched only when the operator asks for it (the show button, or
// loading the current value into the edit form) and lives only in component
// state: it is never logged, put in a URL or written to storage.
import { useEffect, useId, useRef, useState } from "react";
import type { AppInstance, AppSecretInfo, AppSecretsUpdate } from "../api/types";
import type { AppModel, SubmitResult } from "../data/deploy";
import { useLiveSecrets, useSimSecrets, type RevealResult, type SecretsModel } from "../data/secrets";
import { navigate } from "../router";
import { MAX_SECRETS, MAX_SECRET_VALUE, secretNameError, secretValueError } from "../sim/secrets";
import { ago } from "./deploy";
import { Chip, Table, td, type Cell } from "./ui";

/** How long a shown value stays on screen. */
export const REVEAL_MS = 60_000;

interface Props {
  m: AppModel;
  app: string;
  /** another action of the page is in flight */
  busy: boolean;
  setRedeploying(on: boolean): void;
}

export function AppSecrets(p: Props) {
  return p.m.live ? <LiveSecrets {...p} /> : <SimSecrets {...p} />;
}
function LiveSecrets(p: Props) {
  return <SecretsSection {...p} s={useLiveSecrets(p.app)} />;
}
function SimSecrets(p: Props) {
  return <SecretsSection {...p} s={useSimSecrets(p.app)} />;
}

/** One name in a scope: its own secret there, and for an instance the app-wide one it overrides or inherits. */
interface Row {
  name: string;
  own?: AppSecretInfo;
  inherited?: AppSecretInfo;
}

function SecretsSection({ s, m, busy, setRedeploying }: Props & { s: SecretsModel }) {
  const [picked, setPicked] = useState("");
  const [dirty, setDirty] = useState(false);
  const pickId = useId();
  const selected = m.instances.find((i) => i.name === picked) ?? m.instances[0];
  const shared = { s, m, busy, setRedeploying };

  let body;
  if (s.notConfigured) {
    body = (
      <div className="box fillbox">
        <div className="bb">
          <p>서버에 시크릿 키가 설정되어 있지 않습니다. 플랫폼 API에 PLATFORM_SECRETS_KEY를 넣으면 쓸 수 있습니다.</p>
        </div>
      </div>
    );
  } else if (!s.data) {
    body = <p className="hint">{s.error ? "시크릿을 불러오지 못했습니다: " + s.error : "불러오는 중"}</p>;
  } else {
    const app = s.data.app;
    const own = s.data.instances.find((x) => x.instance === selected?.name)?.secrets ?? [];
    const names = [...new Set([...app, ...own].map((x) => x.name))].sort();
    body = (
      <>
        {!s.canEdit && <p className="hint">이 계정의 역할로는 이름만 볼 수 있습니다. 값을 보거나 바꾸려면 operator 역할이 필요합니다.</p>}
        <SecretScope {...shared} label="앱 공통 시크릿" title="앱 공통" note="모든 인스턴스가 받습니다" rows={app.map((x) => ({ name: x.name, own: x }))} targets={m.instances} />
        {selected && (
          <>
            <div className="form">
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
            </div>
            <SecretScope
              {...shared}
              key={selected.name}
              instance={selected.name}
              label="인스턴스별 덮어쓰기"
              title={selected.name + "이(가) 받는 시크릿"}
              note="앱 공통 값 위에 덮어쓰기를 얹은 것"
              rows={names.map((name) => ({ name, own: own.find((x) => x.name === name), inherited: app.find((x) => x.name === name) }))}
              targets={[selected]}
              onDirty={setDirty}
            />
          </>
        )}
      </>
    );
  }
  return (
    <section className="sec">
      <h2>시크릿</h2>
      <p className="hint">
        앱에 환경 변수로 넣는 비밀 값입니다. 서버가 암호화해 보관하고, 보기를 누를 때만 값을 불러와 {REVEAL_MS / 1000}초 동안 보여 줍니다. platform.yaml의 env와 이름이 같으면 시크릿이
        이깁니다.
      </p>
      {!s.live && <p className="hint">데모 모드: 가짜 값이며 이 탭의 메모리에만 있습니다. 서버에는 요청하지 않습니다.</p>}
      {body}
    </section>
  );
}

/* ---------- shown values ---------- */

/**
 * The values on screen, by name. They live only in this state: hiding one,
 * leaving the page (unmount) and REVEAL_MS after it was shown drop it. The
 * expiry runs on an interval and Date.now, so tests can fake just those.
 */
function useShown(fetchValue: (name: string, signal: AbortSignal) => Promise<RevealResult>, onError: (message: string) => void) {
  const [shown, setShown] = useState<ReadonlyMap<string, { value: string; at: number }>>(() => new Map());
  const [loading, setLoading] = useState<readonly string[]>([]);
  const ctrls = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const c = ctrls.current;
    return () => c.forEach((x) => x.abort());
  }, []);
  const any = shown.size > 0;
  useEffect(() => {
    if (!any) return;
    const t = setInterval(() => {
      const now = Date.now();
      setShown((m) => {
        const keep = [...m].filter(([, v]) => now - v.at < REVEAL_MS);
        return keep.length === m.size ? m : new Map(keep);
      });
    }, 1000);
    return () => clearInterval(t);
  }, [any]);

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
  onDirty?(dirty: boolean): void;
}

function SecretScope(p: ScopeProps) {
  const { s, instance, onDirty } = p;
  const [changes, setChanges] = useState<ReadonlyMap<string, Change>>(() => new Map());
  /** the name being edited; "" shows the add form */
  const [editing, setEditing] = useState("");
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

  const byName = new Map(p.rows.map((r) => [r.name, r]));
  const rows: Row[] = [...p.rows, ...[...changes.keys()].filter((n) => !byName.has(n)).sort().map((name) => ({ name }))];
  const ownCount = p.rows.filter((r) => r.own).length;
  const what = instance ? instance + "의 덮어쓰기" : "앱 공통 시크릿";
  /** `what` with its object particle */
  const whatObj = instance ? what + "를" : what + "을";

  function stage(name: string, c: Change) {
    shown.hide(name);
    setChanges((m) => new Map(m).set(name, c));
    setEditing("");
    setSaved(false);
    setLines([]);
    setError("");
  }
  function revert(name: string) {
    setChanges((m) => {
      const next = new Map(m);
      next.delete(name);
      return next;
    });
  }
  function cancel() {
    setChanges(new Map());
    setEditing("");
    setError("");
  }
  /** Why `name` cannot be added here; "" when it can. */
  function taken(name: string): string {
    if (changes.has(name)) return "이미 변경에 넣은 이름입니다. 목록에서 되돌린 뒤 다시 넣으세요";
    if (byName.get(name)?.own) return (instance ? "이미 덮어쓴 이름입니다" : "이미 있는 이름입니다") + ". 목록에서 수정을 누르세요";
    const added = [...changes].filter(([n, c]) => !("remove" in c) && !byName.get(n)?.own).length;
    const removed = [...changes.values()].filter((c) => "remove" in c).length;
    if (ownCount + added - removed >= MAX_SECRETS) return "시크릿은 " + (instance ? "인스턴스마다 " : "") + MAX_SECRETS + "개까지입니다";
    return "";
  }
  async function save() {
    const set: Record<string, string> = {};
    const remove: string[] = [];
    for (const [n, c] of changes) {
      if ("remove" in c) remove.push(n);
      else set[n] = c.value;
    }
    const body: AppSecretsUpdate = { ...(instance ? { instance } : {}), ...(Object.keys(set).length ? { set } : {}), ...(remove.length ? { delete: remove } : {}) };
    setSaving(true);
    setError("");
    const err = await s.save(body);
    setSaving(false);
    if (err) return setError("저장하지 못했습니다: " + err);
    setChanges(new Map());
    setEditing("");
    shown.clear();
    setLines([]);
    setSaved(true);
  }
  async function redeploy(list: AppInstance[]) {
    p.setRedeploying(true);
    setLines([]);
    try {
      const out = await Promise.all(list.map(async (i) => ({ instance: i.name, r: await p.m.redeployNoBuild(i.branch) })));
      // One instance goes to its deployment like the deploy button; several stay here with a link each.
      if (out.length === 1 && "deploymentId" in out[0].r) navigate("#deploy-" + out[0].r.deploymentId);
      else setLines(out);
    } finally {
      p.setRedeploying(false);
    }
  }

  const head = ["이름", ...(s.canEdit ? ["값"] : []), ...(instance ? ["출처"] : []), "바꾼 때", ...(s.canEdit ? [""] : [])];
  const table = rows.map((r) => {
    const c = changes.get(r.name);
    const cells: Cell[] = [
      td(
        <span className="chips">
          <span className="m">{r.name}</span>
          {c && <Chip kind="run">{changeLabel(r, c)} 예정</Chip>}
        </span>,
      ),
    ];
    if (s.canEdit) {
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
            <span className="m" aria-hidden="true">
              ••••••••
            </span>
          ),
        ),
      );
    }
    if (instance) cells.push(td(r.own ? <Chip>{r.inherited ? "덮어씀" : "이 인스턴스만"}</Chip> : r.inherited ? <span className="hint">앱 공통</span> : "-", "nw"));
    cells.push(td(r.own ? ago(r.own.updatedAt, s.now) + ", " + r.own.updatedBy : "-", "nw"));
    if (s.canEdit) {
      const btn = (text: string, onClick: () => void, extra: { pressed?: boolean; disabled?: boolean } = {}) => (
        <button type="button" className="btn ghost" aria-label={r.name + " " + text} aria-pressed={extra.pressed} disabled={extra.disabled} onClick={onClick}>
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
                {btn(r.inherited ? "덮어쓰기 지우기" : "삭제", () => stage(r.name, { remove: true }))}
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
  return (
    <section className="sec" aria-label={p.label}>
      <div className="box">
        <div className="bh">
          <b>{p.title}</b>
          <span className="hint">{p.note}</span>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <p className="hint">{instance ? "앱 공통 시크릿도 덮어쓰기도 없습니다." : "아직 시크릿이 없습니다."}</p>
          </div>
        ) : (
          <Table head={head} rows={table} />
        )}
      </div>
      {s.canEdit &&
        (row ? (
          <SecretForm
            key={"edit:" + editing}
            name={editing}
            title={editing + (row.own ? " 값 바꾸기" : " 덮어쓰기")}
            loadLabel={row.own ? "현재 값 불러오기" : "앱 공통 값 불러오기"}
            load={(signal) => s.reveal(editing, row.own ? instance : undefined, signal)}
            taken={() => ""}
            onStage={(name, value) => stage(name, { value })}
            onClose={() => setEditing("")}
          />
        ) : (
          <SecretForm key="add" title={instance ? "이 인스턴스에 덮어쓰기 추가" : "시크릿 추가"} taken={taken} onStage={(name, value) => stage(name, { value })} />
        ))}
      {s.canEdit && dirty && (
        <div className="box fillbox" role="status" aria-label={what + " 저장하지 않은 변경"}>
          <div className="bb">
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
        </div>
      )}
      {error && (
        <div className="box badbox" role="alert">
          <div className="bb">
            <p>{error}</p>
          </div>
        </div>
      )}
      {saved && (
        <div className="box okbox" role="status" aria-label={what + " 저장됨"}>
          <div className="bb">
            <b>{whatObj} 저장했습니다.</b>
            <p>
              실행 중인 {instance ? "인스턴스는" : "인스턴스들은"} 재배포할 때까지 이전 값을 씁니다. 재배포는 빌드하지 않고 마지막 정상 배포를 지금 시크릿으로 다시 배포합니다.
            </p>
            <div className="actrow">
              {p.targets.map((i) => (
                <button key={i.name} type="button" className="btn" disabled={p.busy} onClick={() => redeploy([i])}>
                  {i.name} 재배포
                </button>
              ))}
              {p.targets.length > 1 && (
                <button type="button" className="btn primary" disabled={p.busy} onClick={() => redeploy(p.targets)}>
                  모든 인스턴스 재배포
                </button>
              )}
            </div>
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
  /** why a new name cannot be added; "" when it can */
  taken(name: string): string;
  onStage(name: string, value: string): void;
  onClose?(): void;
}

function SecretForm(p: FormProps) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [errs, setErrs] = useState<{ name?: string; value?: string }>({});
  const [loading, setLoading] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const id = useId();

  async function load() {
    ctrl.current?.abort();
    const c = (ctrl.current = new AbortController());
    setLoading(true);
    const r = await p.load!(c.signal);
    if (c.signal.aborted) return;
    setLoading(false);
    if ("value" in r) {
      setValue(r.value);
      setErrs({});
    } else setErrs({ value: "값을 불러오지 못했습니다: " + r.error });
  }
  function submit() {
    const n = p.name ?? name.trim();
    const e = { name: p.name ? "" : secretNameError(n) || p.taken(n), value: secretValueError(value) };
    if (e.name || e.value) return setErrs(e);
    p.onStage(n, value);
    setName("");
    setValue("");
    setErrs({});
  }
  return (
    <div className="box">
      <div className="bh">
        <b>{p.title}</b>
        <span className="hint">저장을 누르기 전에는 서버에 보내지 않습니다</span>
      </div>
      <div className="bb">
        <div className="form">
          {!p.name && (
            <div className="field">
              <label htmlFor={id + "n"}>이름</label>
              <input
                id={id + "n"}
                value={name}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!!errs.name}
                aria-describedby={id + "nm"}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrs((x) => ({ ...x, name: "" }));
                }}
              />
              <small id={id + "nm"}>{errs.name ? (
                  <span className="entry-err" role="alert">
                    {errs.name}
                  </span>
                ) : "영문 대문자, 숫자, _로 64자까지. 예: HOST_CODE"}</small>
            </div>
          )}
          <div className="field">
            <label htmlFor={id + "v"}>{p.name ? p.name + " 새 값" : "값"}</label>
            <input
              id={id + "v"}
              value={value}
              spellCheck={false}
              autoComplete="off"
              autoFocus={!!p.name}
              aria-invalid={!!errs.value}
              aria-describedby={id + "vm"}
              onChange={(e) => {
                setValue(e.target.value);
                setErrs((x) => ({ ...x, value: "" }));
              }}
            />
            <small id={id + "vm"}>
              {errs.value ? (
                <span className="entry-err" role="alert">
                  {errs.value}
                </span>
              ) : MAX_SECRET_VALUE + "바이트까지." + (p.name ? " 새 값을 넣거나 지금 값을 불러와 고치세요." : "")}
            </small>
          </div>
        </div>
        <div className="actrow">
          <button type="button" className="btn" onClick={submit}>
            변경에 넣기
          </button>
          {p.load && (
            <button type="button" className="btn ghost" disabled={loading} onClick={load}>
              {loading ? "불러오는 중" : p.loadLabel}
            </button>
          )}
          {p.onClose && (
            <button type="button" className="btn ghost" onClick={p.onClose}>
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
