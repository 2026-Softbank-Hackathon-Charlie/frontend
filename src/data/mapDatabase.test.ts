import type { App } from "../api/types";
import { databasePresence } from "./mapDatabase";

const noDb: App = { name: "docker-doom", namespace: "docker-doom", database: { name: "", user: "", schemas: [] }, resources: { postgres: false, s3: false }, environments: [],
  deploy: { repo: "org/docker-doom", branch: "main", environments: ["gke", "onprem"], autoDeploy: false, spec: { name: "docker-doom", services: [], resources: [] }, specCommit: "a", createdAt: "2026-11-08T00:00:00Z", createdBy: "test", status: [], instances: [] } };

it("uses explicit registered DB dependencies and never equates unavailable app metadata with no DB", () => {
  expect(databasePresence(undefined)).toBe("unknown");
  expect(databasePresence({ ...noDb, deploy: undefined })).toBe("unknown");
  expect(databasePresence(noDb)).toBe("none");
  expect(databasePresence({ ...noDb, name: "hello-onprem" })).toBe("none");
  expect(databasePresence({ ...noDb, deploy: { ...noDb.deploy!, spec: { ...noDb.deploy!.spec, resources: [{ name: "db", type: "postgres" }] } } })).toBe("present");
  expect(databasePresence({ ...noDb, environments: [{ env: "gke", cnpgCluster: "moimroom-mig-db", dbHost: "host" }] })).toBe("present");
});

it("treats both explicit none endpoints as DB-free independently of file migration", () => {
  const none = { kind: "none" as const, env: "gke", namespace: "", cluster: "" };
  expect(databasePresence(undefined, none, { ...none, env: "onprem" })).toBe("none");
  expect(databasePresence(noDb, { ...none, kind: "cnpg", namespace: "room", cluster: "db" }, none)).toBe("present");
});
