import { render, screen } from "@testing-library/react";
import type { Environment } from "../api/types";
import ja from "../i18n/ja.json";
import { makeTranslator } from "../i18n/translate";
import { EnvLabel, RoutesView, trafficText } from "./shared";

describe("route result measurements", () => {
  it("shows measured zero counts even without an optional finish timestamp", () => {
    render(<RoutesView routes={[{ source: "eks", target: "gke", status: "succeeded", runId: "run_zero", result: { missingRows: 0, missingWrites: 0, missingFiles: 0, failedRequests: 0, requests: 0 } }]} />);
    expect(screen.getByRole("cell", { name: "0 / 0 / 0" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "0건" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "0" })).toBeInTheDocument();
  });

  it("does not replace an unmeasured count with zero", () => {
    render(<RoutesView routes={[{ source: "eks", target: "gke", status: "succeeded", finishedAt: "2026-11-07T00:00:00Z", result: { missingRows: 0, missingFiles: 2 } }]} />);
    expect(screen.getByRole("cell", { name: "0 / 미측정 / 2" })).toBeInTheDocument();
  });

  it("does not invent measurements for a route without a run", () => {
    render(<RoutesView routes={[{ source: "eks", target: "gke" }]} />);
    expect(screen.getByText("미실행")).toBeInTheDocument();
    expect(screen.queryByText("0 / 0 / 0")).not.toBeInTheDocument();
  });
});

describe("cluster card traffic text", () => {
  const env = (name: string, live: boolean) => ({ name, gatewayBackend: name, live }) as Environment;

  it("follows the apps' gateways: the clusters that take writes, with the number of apps", () => {
    expect(trafficText(env("eks", false), ["eks", "eks", "eks"])).toBe("쓰기 받음 (앱 3개)");
    expect(trafficText(env("gke", true), ["eks", "eks", "eks"])).toBe("대기");
    expect(trafficText(env("gke", false), ["eks", "gke"])).toBe("쓰기 받음 (앱 1개)");
  });

  it("uses what could be read: an unreadable app does not count, an unanswered one shows no verdict yet", () => {
    expect(trafficText(env("eks", false), ["eks", null])).toBe("쓰기 받음 (앱 1개)");
    expect(trafficText(env("gke", true), ["eks", null])).toBe("대기");
    expect(trafficText(env("gke", true), [undefined, undefined])).toBe("-");
  });

  it("falls back to the platform's live flag with no app, or when no app's gateway could be read", () => {
    expect(trafficText(env("gke", true), [])).toBe("쓰기 받음");
    expect(trafficText(env("eks", false), [])).toBe("대기");
    expect(trafficText(env("gke", true), [null, null])).toBe("쓰기 받음");
    expect(trafficText(env("eks", false), [null])).toBe("대기");
  });

  it("has Japanese for the texts this change adds", () => {
    const tr = makeTranslator(ja);
    const texts = [
      "쓰기 받음 (앱 3개)",
      "트래픽을 볼 앱",
      "앱 목록을 읽지 못해 앱을 지정하지 않은 기본 게이트웨이를 보여 줍니다. 등록된 앱의 트래픽과 다를 수 있습니다.",
      // the migration map's target nodes
      "replica · 정상",
      "primary · 준비 중 0/1",
      "배포 실패",
      "상태 나쁨",
      "상태 모름",
      "배포 대기",
    ];
    expect(texts.filter((t) => { const out = tr(t); return out === null || /[가-힣]/.test(out); })).toEqual([]);
  });
});

describe("environment label", () => {
  it("puts the provider logo or a server icon before the label, and nothing for an unknown name", () => {
    const icon = (env: string) => render(<EnvLabel env={env} label="x" />).container.querySelector("img, svg");
    expect(icon("eks")?.getAttribute("src")).toBe("/env/aws.svg");
    expect(icon("gke")?.getAttribute("src")).toBe("/env/gcp.svg");
    expect(icon("onprem")?.tagName.toLowerCase()).toBe("svg");
    expect(icon("")).toBeNull();
  });
});
