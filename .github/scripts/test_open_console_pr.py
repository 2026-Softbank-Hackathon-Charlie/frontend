import base64
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("open_console_pr", Path(__file__).with_name("open-console-pr.py"))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

REPOSITORY = "525091405886.dkr.ecr.ap-northeast-2.amazonaws.com/hopcharlie/console"
SHA = "1234567" + "a" * 33
OLD = f"{REPOSITORY}:7654321@sha256:" + "b" * 64
IMAGE = f"{REPOSITORY}:{SHA[:7]}@sha256:" + "c" * 64
ENV = {
    "GH_TOKEN": "test-token",
    "INFRA_REPOSITORY": "example/infra",
    "IMAGE": IMAGE,
    "GITHUB_SHA": SHA,
    "GITHUB_REPOSITORY": "example/frontend",
    "GITHUB_RUN_ID": "42",
    "GITHUB_RUN_ATTEMPT": "1",
}


class FakeAPI:
    def __init__(self, image=OLD, fail=None):
        self.values = {"images": {"console": image, "platform": "keep-platform"}, "ingress": {"enabled": True}}
        name, digest = image.split("@")
        self.lock = {"schema_version": 1, "images": {name: digest, "keep:tag": "keep-digest"}}
        self.calls = []
        self.fail = fail

    def __call__(self, method, endpoint, payload=None):
        self.calls.append((method, endpoint, copy.deepcopy(payload)))
        if self.fail == (method, endpoint.rsplit("/", 1)[-1]):
            raise RuntimeError("API failed")
        if method == "GET":
            if endpoint.endswith("git/ref/heads/main"):
                return {"object": {"sha": "main-sha"}}
            if endpoint.endswith("git/commits/main-sha"):
                return {"tree": {"sha": "base-tree"}}
            for path, data in [(MODULE.VALUES_PATH, self.values), (MODULE.LOCK_PATH, self.lock)]:
                if endpoint.endswith(f"contents/{path}?ref=main-sha"):
                    return {"content": base64.b64encode(json.dumps(data).encode()).decode()}
        elif method == "POST":
            return {"sha": "created-sha", "html_url": "https://github.com/example/infra/pull/7"}
        raise AssertionError(f"Unexpected API request: {method} {endpoint}")

    @property
    def writes(self):
        return [c for c in self.calls if c[0] != "GET"]


class ConsolePRTests(unittest.TestCase):
    def test_updates_both_files_atomically_and_preserves_everything_else(self):
        api = FakeAPI()
        original_values, original_lock = copy.deepcopy(api.values), copy.deepcopy(api.lock)
        self.assertEqual(MODULE.create_pull_request(ENV, api), "https://github.com/example/infra/pull/7")
        self.assertEqual([c[1].split("/git/")[-1] for c in api.writes[:3]], ["trees", "commits", "refs"])
        tree = api.writes[0][2]
        self.assertEqual(tree["base_tree"], "base-tree")
        self.assertEqual({item["path"] for item in tree["tree"]}, {MODULE.VALUES_PATH, MODULE.LOCK_PATH})
        changes = {item["path"]: json.loads(item["content"]) for item in tree["tree"]}
        expected_values = copy.deepcopy(original_values)
        expected_values["images"]["console"] = IMAGE
        self.assertEqual(changes[MODULE.VALUES_PATH], expected_values)
        expected_lock = copy.deepcopy(original_lock)
        del expected_lock["images"][OLD.split("@")[0]]
        expected_lock["images"][IMAGE.split("@")[0]] = IMAGE.split("@")[1]
        self.assertEqual(changes[MODULE.LOCK_PATH], expected_lock)
        self.assertEqual(api.writes[1][2]["parents"], ["main-sha"])
        self.assertEqual(api.writes[1][2]["tree"], "created-sha")
        self.assertEqual(api.writes[2][2], {"ref": "refs/heads/codex/frontend-1234567-42-1", "sha": "created-sha"})
        self.assertEqual(api.writes[3][2]["base"], "main")
        self.assertEqual(api.writes[3][2]["head"], "codex/frontend-1234567-42-1")
        self.assertIn(SHA, api.writes[3][2]["body"])
        self.assertIn("Argo CD", api.writes[3][2]["body"])
        self.assertTrue(all(method == "POST" for method, _, _ in api.writes))
        self.assertFalse(any("refs/heads/main" in json.dumps(payload) for _, _, payload in api.writes))

    def test_already_current_image_does_not_write_or_create_a_pr(self):
        api = FakeAPI(IMAGE)
        self.assertIsNone(MODULE.create_pull_request(ENV, api))
        self.assertEqual(api.writes, [])

    def test_same_tag_with_new_digest_updates_both_pins(self):
        api = FakeAPI(IMAGE.replace("c" * 64, "d" * 64))
        MODULE.create_pull_request(ENV, api)
        changes = {item["path"]: json.loads(item["content"]) for item in api.writes[0][2]["tree"]}
        self.assertEqual(changes[MODULE.VALUES_PATH]["images"]["console"], IMAGE)
        self.assertEqual(changes[MODULE.LOCK_PATH]["images"][IMAGE.split("@")[0]], IMAGE.split("@")[1])

    def test_bad_input_fails_before_any_api_call(self):
        for change in [{"IMAGE": IMAGE.replace("sha256:", "md5:")}, {"GITHUB_SHA": "f" * 40}, {"GITHUB_RUN_ID": "42\nmain"}, {"GH_TOKEN": ""}]:
            with self.subTest(change=change):
                api = FakeAPI()
                with self.assertRaises(ValueError):
                    MODULE.create_pull_request({**ENV, **change}, api)
                self.assertEqual(api.calls, [])

    def test_wrong_repository_and_inconsistent_lock_fail_before_writes(self):
        for mutate in ["repository", "missing-lock", "wrong-digest"]:
            with self.subTest(mutate=mutate):
                api = FakeAPI()
                if mutate == "repository":
                    api.values["images"]["console"] = OLD.replace("/console:", "/other:")
                elif mutate == "missing-lock":
                    api.lock["images"].pop(OLD.split("@")[0])
                else:
                    api.lock["images"][OLD.split("@")[0]] = "sha256:" + "e" * 64
                with self.assertRaises(ValueError):
                    MODULE.create_pull_request(ENV, api)
                self.assertEqual(api.writes, [])

    def test_api_failure_propagates_without_branch_or_pr_mutation(self):
        for failure, writes in [
            (("GET", "main"), []),
            (("POST", "commits"), ["trees", "commits"]),
            (("POST", "refs"), ["trees", "commits", "refs"]),
            (("POST", "pulls"), ["trees", "commits", "refs", "repos/example/infra/pulls"]),
        ]:
            with self.subTest(failure=failure):
                api = FakeAPI(fail=failure)
                with self.assertRaisesRegex(RuntimeError, "API failed"):
                    MODULE.create_pull_request(ENV, api)
                self.assertEqual([c[1].split("/git/")[-1] for c in api.writes], writes)

    def test_api_sends_multiline_contents_as_json_without_a_shell(self):
        payload = {"content": "literal $(printf unsafe)\nsecond line"}
        with patch.object(MODULE.subprocess, "run") as run:
            run.return_value.stdout = '{"sha":"result"}'
            self.assertEqual(MODULE.api("POST", "repos/example/infra/git/trees", payload), {"sha": "result"})
        args, kwargs = run.call_args
        self.assertEqual(args[0][-2:], ["--input", "-"])
        self.assertEqual(json.loads(kwargs["input"]), payload)
        self.assertFalse(kwargs.get("shell", False))


if __name__ == "__main__":
    unittest.main()
