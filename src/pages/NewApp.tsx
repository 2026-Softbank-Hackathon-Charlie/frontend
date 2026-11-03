import { useEffect, useState } from "react";
import type { AppSpecValidation } from "../api/types";
import { SpecResult } from "../components/deploy";
import { PageHead } from "../components/ui";
import { useLiveNewApp, useSimNewApp, type NewAppModel } from "../data/deploy";
import { useLive } from "../data/live";
import { navigate } from "../router";

const crumb = <a href="#apps">앱</a>;

export function NewApp() {
  return useLive() ? <LiveNewApp /> : <SimNewApp />;
}
function LiveNewApp() {
  return <NewAppForm m={useLiveNewApp()} />;
}
function SimNewApp() {
  return <NewAppForm m={useSimNewApp()} />;
}

function NewAppForm({ m }: { m: NewAppModel }) {
  const [repoSel, setRepo] = useState("");
  /** null: the repo's default branch */
  const [branchSel, setBranch] = useState<string | null>(null);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [busy, setBusy] = useState(false);
  /** what the last submit got back instead of a deployment, for the repo and branch it was for */
  const [refused, setRefused] = useState<{ key: string; validation?: AppSpecValidation; error?: string }>();

  const repos = m.repos ?? [];
  const repo = repos.find((r) => r.fullName === repoSel) ?? repos.find((r) => !m.registered[r.fullName]);
  const typed = branchSel ?? repo?.defaultBranch ?? "main";
  const branch = typed || repo?.defaultBranch || "main";
  const key = (repo?.fullName ?? "") + "@" + branch;
  const { setQuery } = m;
  useEffect(() => setQuery(repo?.fullName ?? "", branch), [setQuery, repo?.fullName, branch]);

  const envs = m.envs ?? [];
  const chosen = envs.filter((e) => !off[e.value]).map((e) => e.value);
  const mine = refused?.key === key ? refused : undefined;
  const check = mine?.validation ? { ...m.check, data: mine.validation, error: undefined, loading: false } : m.check;
  const can = !!repo && !!check.data?.valid && !check.loading && chosen.length > 0 && !busy;

  async function submit() {
    if (!repo) return;
    setBusy(true);
    setRefused(undefined);
    const r = await m.submit({ repo: repo.fullName, branch, environments: chosen, autoDeploy });
    setBusy(false);
    if ("deploymentId" in r) navigate("#deploy-" + r.deploymentId);
    else setRefused({ key, ...r });
  }

  return (
    <div className="page">
      <PageHead title="새 앱 배포" sub="GitHub 레포를 연결하면 push할 때마다 빌드하고, 고른 환경에 동시에 배포합니다." crumb={crumb} />
      <div className="box">
        <div className="bb">
          <div className="form">
            <div className="field">
              <label htmlFor="dep-repo">GitHub 레포</label>
              <select
                id="dep-repo"
                value={repo?.fullName ?? ""}
                disabled={!m.repos}
                onChange={(e) => {
                  setRepo(e.target.value);
                  setBranch(null);
                }}
              >
                {!repo && <option value="">{m.repos ? "등록할 수 있는 레포가 없습니다" : "불러오는 중"}</option>}
                {repos.map((r) => {
                  const reg = m.registered[r.fullName];
                  return (
                    <option key={r.fullName} value={r.fullName} disabled={!!reg}>
                      {r.fullName + (r.private ? " (비공개)" : "") + (reg ? " (등록됨)" : "")}
                    </option>
                  );
                })}
              </select>
              <small>{m.reposError ? "레포 목록을 불러오지 못했습니다: " + m.reposError : "플랫폼의 GitHub App이 볼 수 있는 레포입니다."}</small>
            </div>
            <div className="field">
              <label htmlFor="dep-branch">배포할 브랜치</label>
              <input id="dep-branch" value={typed} spellCheck={false} autoComplete="off" onChange={(e) => setBranch(e.target.value.trim())} />
              <small>이 브랜치의 head에서 platform.yaml을 읽고, push할 때마다 이 브랜치를 배포합니다. 기본은 레포의 기본 브랜치입니다.</small>
            </div>
            <fieldset className="field">
              <legend>배포 환경</legend>
              {m.envsError ? (
                <small>환경을 불러오지 못했습니다: {m.envsError}</small>
              ) : !m.envs ? (
                <small>불러오는 중</small>
              ) : (
                <div className="checks">
                  {envs.map((e) => (
                    <label key={e.value}>
                      <input type="checkbox" id={"dep-env-" + e.value} checked={!off[e.value]} onChange={(x) => setOff({ ...off, [e.value]: !x.target.checked })} /> {e.label}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <label className="check">
              <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)} /> push할 때마다 자동으로 배포
            </label>
          </div>
        </div>
      </div>
      <SpecResult check={check} />
      {mine?.error && (
        <div className="box badbox" role="alert">
          <div className="bb">
            <b>배포를 시작하지 못했습니다.</b>
            <p>{mine.error}</p>
          </div>
        </div>
      )}
      <div className="actrow">
        <button type="button" className="btn primary" disabled={!can} onClick={submit}>
          {busy ? "등록하는 중" : "배포 시작"}
        </button>
        <span className="hint">예상 2~4분, 목표 5분 이내</span>
      </div>
    </div>
  );
}
