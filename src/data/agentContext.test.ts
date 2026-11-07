import { fakeAgentSession, fakeRun } from "../api/fakes";
import type { App, PlanRecord } from "../api/types";
import { sessionContext } from "./agentContext";

const app: App = { name: "moimroom-mig", namespace: "room", database: { name: "app", user: "app", schemas: [] },
  environments: ["gke", "eks"].map(env => ({ env, cnpgCluster: "room-db", dbHost: "host" })) };
const plan: PlanRecord = { ref: "pln_one", revision: 1, status: "approved", submittedBy: "operator", submittedAt: "2026-11-08T00:00:00Z",
  summary: { planId: "not-an-app-name", source: { env: "gke", namespace: "room", cluster: "room-db" }, target: { env: "eks", namespace: "room", cluster: "room-db" }, files: true, gatewayMode: "http", fenceGate: true, maxDowntime: "30s" } };

it("joins exact plan references and uniquely declared DB endpoints instead of session titles", () => {
  const s = fakeAgentSession({ planRef: "pln_one", title: "wrong-app onprem to other" });
  expect(sessionContext(s, [plan], [], [app])).toMatchObject({ app: "moimroom-mig", source: "gke", target: "eks" });
  expect(sessionContext({ ...s, planRef: "missing" }, [plan], [], [app])).toEqual({});
  expect(sessionContext({ ...s, planRef: undefined }, [plan], [], [app])).toEqual({});
});

it("uses an exact run ID and preserves explicit stateless app metadata", () => {
  const run = Object.assign(fakeRun({ runId: "run_one" }), { app: "docker-doom", source: { kind: "none", env: "gke", namespace: "", cluster: "" }, target: { kind: "none", env: "onprem", namespace: "", cluster: "" } });
  expect(sessionContext(fakeAgentSession({ runId: "run_one" }), [], [run], [])).toMatchObject({ app: "docker-doom", source: "gke", target: "onprem" });
});

it("does not guess an ambiguous app or combine conflicting run and plan links", () => {
  const s = fakeAgentSession({ planRef: plan.ref });
  expect(sessionContext(s, [plan], [], [app, { ...app, name: "another-app" }])).toMatchObject({ app: undefined, source: "gke", target: "eks" });
  const run = fakeRun({ runId: "run_one", planRef: "different-plan" });
  expect(sessionContext({ ...s, runId: run.runId }, [plan], [run], [app])).toEqual({});
});
