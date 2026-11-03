#!/usr/bin/env python3
"""Open an infra review PR for a published console image; never deploy it directly."""

import base64
import json
import os
from pathlib import Path
import re
import subprocess


VALUES_PATH = "clusters/aws-dev-management/values/hopcharlie-platform.yaml"
LOCK_PATH = "helm/images.lock.json"
IMAGE_PATTERN = re.compile(
    r"(?P<repository>[0-9]{12}\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com/"
    r"[a-z0-9]+(?:[._/-][a-z0-9]+)*):(?P<tag>[0-9a-f]{7})@(?P<digest>sha256:[0-9a-f]{64})"
)


def api(method, endpoint, payload=None):
    command = ["gh", "api", "--method", method, endpoint, "-H", "Accept: application/vnd.github+json"]
    if payload is not None:
        command.extend(["--input", "-"])
    result = subprocess.run(
        command, input=json.dumps(payload) if payload is not None else None,
        text=True, capture_output=True, check=True,
    )
    return json.loads(result.stdout)


def create_pull_request(env, request=api):
    for key in ("GH_TOKEN", "INFRA_REPOSITORY", "IMAGE", "GITHUB_SHA", "GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        if not env.get(key):
            raise ValueError(f"Missing environment variable: {key}")
    for key in ("INFRA_REPOSITORY", "GITHUB_REPOSITORY"):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", env[key]):
            raise ValueError(f"Invalid repository: {key}")
    for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
        if not re.fullmatch(r"[1-9][0-9]*", env[key]):
            raise ValueError(f"Invalid workflow identifier: {key}")
    image = IMAGE_PATTERN.fullmatch(env["IMAGE"])
    if not re.fullmatch(r"[0-9a-f]{40}", env["GITHUB_SHA"]) or not image or image["tag"] != env["GITHUB_SHA"][:7]:
        raise ValueError("IMAGE must pin the source commit's 7-character tag and a sha256 digest")

    repo = f"repos/{env['INFRA_REPOSITORY']}"
    base = request("GET", f"{repo}/git/ref/heads/main")["object"]["sha"]
    files = {}
    for path in (VALUES_PATH, LOCK_PATH):
        content = request("GET", f"{repo}/contents/{path}?ref={base}")["content"]
        files[path] = json.loads(base64.b64decode(content).decode("utf-8"))
    values, lock = files[VALUES_PATH], files[LOCK_PATH]
    old = IMAGE_PATTERN.fullmatch(values["images"]["console"])
    if not old or old["repository"] != image["repository"]:
        raise ValueError("The image must use the existing infra console repository")
    old_name = f"{old['repository']}:{old['tag']}"
    if lock["images"].get(old_name) != old["digest"]:
        raise ValueError("The existing console image and images.lock.json disagree")
    if values["images"]["console"] == env["IMAGE"]:
        return None

    values["images"]["console"] = env["IMAGE"]
    new_name = f"{image['repository']}:{image['tag']}"
    if new_name != old_name:
        del lock["images"][old_name]
    lock["images"][new_name] = image["digest"]
    base_tree = request("GET", f"{repo}/git/commits/{base}")["tree"]["sha"]
    tree = request("POST", f"{repo}/git/trees", {
        "base_tree": base_tree,
        "tree": [{"path": path, "mode": "100644", "type": "blob", "content": json.dumps(data, indent=2, ensure_ascii=False) + "\n"}
                 for path, data in files.items()],
    })
    commit = request("POST", f"{repo}/git/commits", {
        "message": f"chore: update console image to {image['tag']}",
        "tree": tree["sha"], "parents": [base],
    })
    branch = f"codex/frontend-{image['tag']}-{env['GITHUB_RUN_ID']}-{env['GITHUB_RUN_ATTEMPT']}"
    request("POST", f"{repo}/git/refs", {"ref": f"refs/heads/{branch}", "sha": commit["sha"]})
    source = f"https://github.com/{env['GITHUB_REPOSITORY']}"
    pull = request("POST", f"{repo}/pulls", {
        "title": f"chore: update console image to {image['tag']}", "base": "main", "head": branch,
        "body": (
            f"Pin the console image and its lock entry to `{env['IMAGE']}`.\n\n"
            f"Frontend commit: {source}/commit/{env['GITHUB_SHA']}\n\n"
            f"Build: {source}/actions/runs/{env['GITHUB_RUN_ID']}/attempts/{env['GITHUB_RUN_ATTEMPT']}\n\n"
            "This workflow publishes an image and opens this review PR only. After merge, the configured "
            "Argo CD Application must sync infra main. Confirm the console release after that sync; "
            "the workflow does not verify the running release."
        ),
    })
    return pull["html_url"]


def main():
    url = create_pull_request(os.environ)
    summary = f"## Frontend image published\n\nImage: `{os.environ['IMAGE']}`\n\n"
    summary += f"Infra review PR: {url}\n" if url else "Infra main already pins this image; no PR was created.\n"
    summary += "\nThe running console release was not verified. Review/merge and configured Argo CD sync are separate steps.\n"
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as output:
            output.write(summary)
    if os.environ.get("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
            output.write(f"pull-request-url={url or ''}\nimage={os.environ['IMAGE']}\n")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(error.stderr.strip() or str(error)) from error
