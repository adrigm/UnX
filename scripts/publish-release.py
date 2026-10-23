#!/usr/bin/env python3
"""Publish a fully verified release requested by one manifest-only commit.

Uses Python's standard library and the Actions job token. No token or signed
artifact URL is printed. All build, input and byte checks precede API writes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPOSITORY = "adrigm/UnX"
BRANCH = "fix/steam-25501027-speed"
REQUEST_PATH = "docs/publish-release.json"
BUILD_WORKFLOW = ".github/workflows/build-launcher.yml"
MOD_VERSION = "0.10.0"
MANAGER_VERSION = "1.0.1"
TAG = "v0.10.0"
TITLE = "UnX 0.10.0 (Manager 1.0.1)"
NOTES_PATH = "docs/RELEASE-0.10.0.md"
ARTIFACT_NAMES = {
    "unx-plugin-win32", "unx-manager-linux-x64", "unx-manager-windows-x64",
}
MAX_DOWNLOAD = 1024 * 1024 * 1024
MAX_EXTRACTED = 2 * MAX_DOWNLOAD


class ReleaseError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def strict_json(text):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    try:
        return json.loads(text, object_pairs_hook=unique_pairs)
    except (ValueError, UnicodeError) as error:
        raise ReleaseError("Invalid JSON input") from error


def git(*arguments):
    result = subprocess.run(["git", *arguments], check=False, capture_output=True)
    require(result.returncode == 0, "Git verification failed: " + arguments[0])
    return result.stdout


def read_request(path):
    request = strict_json(path.read_text(encoding="utf-8"))
    fields = {"tag", "mod_version", "manager_version", "source_commit",
              "build_run_id", "sha256", "notes_path"}
    require(isinstance(request, dict) and set(request) == fields,
            "Release request has missing or unexpected fields")
    require(request["tag"] == TAG and request["mod_version"] == MOD_VERSION
            and request["manager_version"] == MANAGER_VERSION,
            "Only the reviewed UnX 0.10.0 / Manager 1.0.1 release is permitted")
    require(request["notes_path"] == NOTES_PATH, "Unexpected release notes path")
    require(isinstance(request["source_commit"], str)
            and re.fullmatch(r"[0-9a-f]{40}", request["source_commit"]),
            "source_commit must be a full lowercase commit SHA")
    require(type(request["build_run_id"]) is int and request["build_run_id"] > 0,
            "build_run_id must be a positive integer")
    hashes = request["sha256"]
    require(isinstance(hashes, dict) and len(hashes) == 7,
            "sha256 must identify exactly the seven required release assets")
    for name, value in hashes.items():
        require(isinstance(name, str) and PurePosixPath(name).name == name
                and re.fullmatch(r"[A-Za-z0-9_.-]+", name), "Unsafe asset name")
        require(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value),
                "Each requested SHA256 must contain 64 lowercase hex digits")
    return request


def verify_checkout(request, environment):
    require(environment.get("GITHUB_ACTIONS") == "true", "Run only inside GitHub Actions")
    require(environment.get("GITHUB_REPOSITORY") == REPOSITORY, "Unexpected repository")
    require(environment.get("GITHUB_REF") == "refs/heads/" + BRANCH, "Unexpected publishing ref")
    require(environment.get("GITHUB_EVENT_NAME") == "push", "Publishing requires a push event")
    head = environment.get("GITHUB_SHA", "")
    require(re.fullmatch(r"[0-9a-f]{40}", head), "Missing event commit SHA")
    require(git("rev-parse", "HEAD").decode().strip() == head, "Checkout differs from event SHA")
    source = request["source_commit"]
    require(source != head, "The request must follow the tested source commit")
    git("merge-base", "--is-ancestor", source, head)
    changes = git("diff", "--name-only", source, head).decode().splitlines()
    allowed_changes = {REQUEST_PATH, "scripts/publish-release.py", "tests/publish_release_test.py"}
    require(REQUEST_PATH in changes and set(changes) <= allowed_changes,
            "Only the release request and publisher script/tests may differ from the tested source; "
            "product and workflow changes require a new verified build")
    committed_request = git("show", head + ":" + REQUEST_PATH)
    require(strict_json(committed_request) == request, "Request differs from committed bytes")
    package = strict_json(git("show", source + ":launcher/package.json"))
    payload = strict_json(git("show", source + ":launcher/payload-manifest.json"))
    require(package.get("version") == MANAGER_VERSION and payload.get("version") == MOD_VERSION,
            "Tested source version does not match the request")
    header = git("show", source + ":UnX/DLL_VERSION.H").decode()
    values = []
    for name in ("UNX_MAJOR", "UNX_MINOR", "UNX_BUILD", "UNX_REV"):
        found = re.search(r"^#define\s+" + name + r"\s+(\d+)\s*$", header, re.MULTILINE)
        require(found is not None, "Missing DLL version field")
        values.append(int(found.group(1)))
    require(values == [0, 10, 0, 0], "Native DLL source version mismatch")
    notes = git("show", source + ":" + NOTES_PATH).decode("utf-8")
    require(notes.strip() and "0.10.0" in notes and "1.0.1" in notes, "Missing versioned release notes")
    require("/home/" not in notes and "/run/media/" not in notes,
            "Release notes contain machine-specific paths")
    return notes


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


class GitHub:
    def __init__(self, token):
        require(bool(token), "GITHUB_TOKEN is required")
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def open(self, method, url, *, data=None, accept="application/vnd.github+json", authenticated=True, content_type=None):
        parsed = urllib.parse.urlsplit(url)
        require(parsed.scheme == "https" and not parsed.username and not parsed.password,
                "Non-HTTPS or credential-bearing download URL refused")
        headers = {"Accept": accept, "User-Agent": "UnX-reviewed-release-publisher",
                   "X-GitHub-Api-Version": "2022-11-28"}
        if authenticated:
            require(parsed.hostname in {"api.github.com", "uploads.github.com"},
                    "Refusing to forward credentials to a download host")
            headers["Authorization"] = "Bearer " + self.token
        if data is not None:
            headers["Content-Type"] = content_type or "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        # API paths identify failures without exposing signed queries, download
        # URLs or credentials. Redirected binary URLs are always redacted.
        endpoint_label = parsed.path if authenticated else "[signed binary download]"
        try:
            return self.opener.open(request, timeout=120)
        except urllib.error.HTTPError as error:
            # Intentionally omit URLs and server bodies, which can contain signed links.
            if error.code in {301, 302, 303, 307, 308, 404}:
                return error
            raise ReleaseError(f"GitHub {method} {endpoint_label} failed (HTTP {error.code})") from None
        except (urllib.error.URLError, TimeoutError):
            raise ReleaseError(f"GitHub {method} {endpoint_label} failed") from None

    def json(self, method, path, value=None, *, optional=False):
        data = None if value is None else json.dumps(value).encode("utf-8")
        with self.open(method, "https://api.github.com" + path, data=data) as response:
            if optional and response.status == 404:
                return None
            require(200 <= response.status < 300, f"Unexpected GitHub response: {response.status}")
            return strict_json(response.read(8 * 1024 * 1024))

    def download(self, api_path, destination):
        if re.fullmatch(r"/repos/" + REPOSITORY + r"/actions/artifacts/[1-9][0-9]*/zip", api_path):
            # Actions artifact downloads negotiate the JSON API media type and
            # return a 302 to the binary archive. octet-stream is rejected here.
            accept = "application/vnd.github+json"
        else:
            require(re.fullmatch(r"/repos/" + REPOSITORY + r"/releases/assets/[1-9][0-9]*", api_path),
                    "Unexpected artifact/asset API download endpoint")
            accept = "application/octet-stream"
        response = self.open("GET", "https://api.github.com" + api_path, accept=accept)
        try:
            for _ in range(6):
                if response.status not in {301, 302, 303, 307, 308}:
                    break
                location = response.headers.get("Location", "")
                parsed = urllib.parse.urlsplit(location)
                host = parsed.hostname or ""
                require(parsed.scheme == "https" and not parsed.username and not parsed.password
                        and any(host.endswith(suffix) for suffix in
                                (".blob.core.windows.net", ".githubusercontent.com", ".actions.githubusercontent.com")),
                        "Unexpected signed-download host")
                response.close()
                # Signed artifact and asset redirects never receive GITHUB_TOKEN.
                response = self.open("GET", location, accept="application/octet-stream", authenticated=False)
            require(response.status == 200, "Artifact/asset download did not return HTTP 200")
            size = 0
            with destination.open("xb") as stream:
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    size += len(block)
                    require(size <= MAX_DOWNLOAD, "Download exceeds the size limit")
                    stream.write(block)
        finally:
            response.close()

    def upload(self, release_id, name, path):
        endpoint = (f"https://uploads.github.com/repos/{REPOSITORY}/releases/{release_id}/assets?"
                    + urllib.parse.urlencode({"name": name}))
        with self.open("POST", endpoint, data=path.read_bytes(), content_type="application/octet-stream") as response:
            require(response.status == 201, "Asset upload did not return HTTP 201")
            return strict_json(response.read(8 * 1024 * 1024))


def verify_build(github, request):
    run_id = request["build_run_id"]
    run = github.json("GET", f"/repos/{REPOSITORY}/actions/runs/{run_id}")
    require(run.get("status") == "completed" and run.get("conclusion") == "success",
            "The requested build is not a completed successful run")
    require(run.get("head_sha") == request["source_commit"], "Build does not test the source commit")
    require(run.get("path") == BUILD_WORKFLOW and run.get("head_branch") == BRANCH,
            "Unexpected build workflow or source branch")
    require(run.get("repository", {}).get("full_name") == REPOSITORY
            and run.get("head_repository", {}).get("full_name") == REPOSITORY,
            "Build belongs to another repository or fork")
    result = []
    page = 1
    while True:
        listing = github.json("GET", f"/repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100&page={page}")
        entries = listing.get("artifacts")
        require(isinstance(entries, list), "Invalid artifact listing")
        result.extend(entries)
        if len(entries) < 100:
            break
        page += 1
        require(page <= 10, "Unexpected artifact pagination")
    selected = {}
    for artifact in result:
        name = artifact.get("name")
        if name not in ARTIFACT_NAMES:
            continue
        require(name not in selected and not artifact.get("expired"), "Missing, duplicate or expired build artifact")
        require(type(artifact.get("id")) is int and artifact["id"] > 0, "Invalid artifact ID")
        selected[name] = artifact
    require(set(selected) == ARTIFACT_NAMES, "The build must contain all three required artifacts")
    return selected


def safe_zip_members(archive):
    total = 0
    names = set()
    for member in archive.infolist():
        name = member.filename
        path = PurePosixPath(name)
        require(name and "\\" not in name and "\x00" not in name and not path.is_absolute()
                and all(part not in {"", ".", ".."} and ":" not in part for part in path.parts),
                "Unsafe archive member")
        require(name not in names, "Duplicate archive member")
        names.add(name)
        kind = stat.S_IFMT(member.external_attr >> 16)
        require(kind in {0, stat.S_IFREG, stat.S_IFDIR}, "Archive links or devices are forbidden")
        total += member.file_size
        require(total <= MAX_EXTRACTED and member.file_size <= MAX_DOWNLOAD,
                "Archive exceeds the extraction size limit")
        yield member


def extract_artifact(path, output):
    files = {}
    with zipfile.ZipFile(path) as archive:
        for member in safe_zip_members(archive):
            if member.is_dir():
                continue
            name = PurePosixPath(member.filename).name
            require(name not in files, "Ambiguous artifact file name")
            destination = output / name
            with archive.open(member) as source, destination.open("xb") as target:
                while block := source.read(1024 * 1024):
                    target.write(block)
            files[name] = destination
    return files


def one_match(files, pattern):
    matches = [name for name in files if re.fullmatch(pattern, name)]
    require(len(matches) == 1, "Expected exactly one versioned native package")
    return matches[0]


def verify_sidecar(files, name):
    require(name + ".sha256" in files, "Package SHA256 sidecar missing")
    text = files[name + ".sha256"].read_text(encoding="ascii")
    require(re.fullmatch(re.escape(digest(files[name])) + r"  " + re.escape(name) + r"\n?", text),
            "Package SHA256 sidecar is invalid")


def verify_payload(path, manifest, plugin):
    require(manifest.get("schemaVersion") == 1 and manifest.get("version") == MOD_VERSION
            and manifest.get("appId") == 359870, "Payload manifest version or app mismatch")
    require(manifest.get("archiveSha256") == digest(path)
            and manifest.get("archiveSize") == path.stat().st_size, "Payload ZIP integrity mismatch")
    require(manifest.get("provenance", {}).get("pluginSha256") == digest(plugin),
            "Plugin artifact differs from payload provenance")
    expected = manifest.get("files")
    require(isinstance(expected, list) and expected, "Payload inventory is missing")
    entries = {}
    for item in expected:
        require(isinstance(item, dict) and set(item) == {"path", "sha256", "size"}, "Invalid payload inventory entry")
        name = item["path"]
        require(isinstance(name, str) and name not in entries, "Duplicate payload inventory entry")
        require(type(item["size"]) is int and item["size"] >= 0
                and isinstance(item["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]),
                "Invalid payload inventory hash or size")
        entries[name] = item
    with zipfile.ZipFile(path) as archive:
        members = list(safe_zip_members(archive))
        require(not any(member.is_dir() for member in members)
                and {member.filename for member in members} == set(entries),
                "Payload ZIP differs from its complete inventory")
        for member in members:
            item = entries[member.filename]
            value = hashlib.sha256()
            with archive.open(member) as stream:
                while block := stream.read(1024 * 1024):
                    value.update(block)
            require(member.file_size == item["size"] and value.hexdigest() == item["sha256"],
                    "Payload file integrity mismatch: " + member.filename)
    require("unx.dll" in entries and entries["unx.dll"]["sha256"] == digest(plugin)
            and entries["unx.dll"]["size"] == plugin.stat().st_size,
            "Payload DLL differs from the compiled plugin artifact")
    with plugin.open("rb") as stream:
        header = stream.read(4096)
    require(len(header) >= 64 and header[:2] == b"MZ", "Plugin is not a PE binary")
    pe = int.from_bytes(header[60:64], "little")
    require(pe + 24 <= len(header) and header[pe:pe + 4] == b"PE\0\0"
            and header[pe + 4:pe + 6] == b"L\x01"
            and int.from_bytes(header[pe + 22:pe + 24], "little") & 0x2000,
            "Plugin is not a Win32 DLL")


def collect_assets(github, request, artifacts, workspace):
    extracted = {}
    for name in sorted(artifacts):
        artifact = artifacts[name]
        archive = workspace / (name + ".zip")
        github.download(f"/repos/{REPOSITORY}/actions/artifacts/{artifact['id']}/zip", archive)
        # New API artifact digests protect the transport archive, independently of assets.
        api_digest = artifact.get("digest")
        if api_digest:
            require(api_digest == "sha256:" + digest(archive), "Artifact API digest mismatch")
        output = workspace / name
        output.mkdir()
        extracted[name] = extract_artifact(archive, output)
    linux = extracted["unx-manager-linux-x64"]
    windows = extracted["unx-manager-windows-x64"]
    plugin = extracted["unx-plugin-win32"]
    require("unx.dll" in plugin, "Compiled plugin missing")
    linux_name = one_match(linux, r"UnX-Manager-1\.0\.1-linux-(?:x64|x86_64)\.AppImage")
    windows_name = one_match(windows, r"UnX-Manager-1\.0\.1-windows-x64\.exe")
    payload_name = "UnX-0.10.0.zip"
    require(payload_name in linux, "Standalone payload ZIP missing from the Linux artifact")
    for files, name in ((linux, linux_name), (windows, windows_name), (linux, payload_name)):
        verify_sidecar(files, name)
    require("payload-manifest.json" in linux and "payload-manifest.json" in windows,
            "Both packaging artifacts must include the manifest")
    require(linux["payload-manifest.json"].read_bytes() == windows["payload-manifest.json"].read_bytes(),
            "Windows and Linux payload manifests differ")
    manifest = strict_json(linux["payload-manifest.json"].read_bytes())
    require(manifest.get("provenance", {}).get("sourceCommit") == request["source_commit"]
            and manifest.get("provenance", {}).get("sourceRepository") == "https://github.com/" + REPOSITORY,
            "Payload provenance does not identify the tested source commit")
    verify_payload(linux[payload_name], manifest, plugin["unx.dll"])
    require(windows[windows_name].read_bytes()[:2] == b"MZ", "Windows manager is not a PE executable")
    with linux[linux_name].open("rb") as stream:
        header = stream.read(12)
    require(header[:4] == b"\x7fELF" and header[8:11] == b"AI\x02", "Linux manager is not an AppImage type 2")
    assets = {name: files[name] for files, name in
              ((windows, windows_name), (windows, windows_name + ".sha256"),
               (linux, linux_name), (linux, linux_name + ".sha256"),
               (linux, payload_name), (linux, payload_name + ".sha256"),
               (linux, "payload-manifest.json"))}
    require(set(assets) == set(request["sha256"]), "Requested assets differ from the complete release asset set")
    for name, path in assets.items():
        require(digest(path) == request["sha256"][name], "Reviewed SHA256 mismatch: " + name)
    return assets


def verify_default_workflows(github, request):
    repository = github.json("GET", f"/repos/{REPOSITORY}")
    default_branch = repository.get("default_branch")
    require(isinstance(default_branch, str) and default_branch,
            "Could not resolve the repository default branch")
    current = github.json("GET", f"/repos/{REPOSITORY}/commits/"
                          + urllib.parse.quote(default_branch, safe=""))
    tree_sha = current.get("commit", {}).get("tree", {}).get("sha", "")
    require(re.fullmatch(r"[0-9a-f]{40}", tree_sha), "Invalid default branch tree")
    tree = github.json("GET", f"/repos/{REPOSITORY}/git/trees/{tree_sha}?recursive=1")
    require(tree.get("truncated") is False and isinstance(tree.get("tree"), list),
            "Could not compare the complete default branch workflows")
    default_files = {entry["path"]: entry["sha"] for entry in tree["tree"]
                     if entry.get("path", "").startswith(".github/workflows/")
                     and entry.get("type") == "blob"}
    source_files = {}
    for entry in git("ls-tree", "-r", "-z", request["source_commit"], "--", ".github/workflows").split(b"\0"):
        if not entry:
            continue
        metadata, path = entry.split(b"\t", 1)
        _, kind, sha = metadata.decode("ascii").split()
        require(kind == "blob", "Unexpected source workflow object")
        source_files[path.decode("utf-8")] = sha
    require(source_files and source_files == default_files,
            "Release refused: the tested source workflows differ from the current default branch. "
            "Merge the reviewed source PR normally before requesting publication; publication is blocked.")


def release_body(notes, request):
    run_id = request["build_run_id"]
    url = f"https://github.com/{REPOSITORY}/actions/runs/{run_id}"
    return (notes.rstrip() + "\n\n## Release build validation\n\n"
            f"The Windows build and native regression tests, and the Windows/Linux manager "
            f"package checks, passed in [build {run_id}]({url}) for source commit "
            f"`{request['source_commit']}`. All seven published assets were checked against "
            "the reviewed SHA256 values and the shared payload manifest before publication.\n")


def tag_commit(github):
    tag = github.json("GET", f"/repos/{REPOSITORY}/git/ref/tags/{TAG}", optional=True)
    if tag is None:
        return None
    target = tag.get("object", {})
    for _ in range(5):
        if target.get("type") == "commit":
            return target.get("sha")
        require(target.get("type") == "tag" and re.fullmatch(r"[0-9a-f]{40}", target.get("sha", "")),
                "Unexpected tag target")
        target = github.json("GET", f"/repos/{REPOSITORY}/git/tags/{target['sha']}").get("object", {})
    raise ReleaseError("Annotated tag nesting is too deep")


def find_release(github):
    # The tag endpoint is documented for published releases. Listing with the
    # job's write-capable token also finds a draft after a partially failed run.
    release = github.json("GET", f"/repos/{REPOSITORY}/releases/tags/{TAG}", optional=True)
    if release is not None:
        return release
    matches = []
    for page in range(1, 11):
        entries = github.json("GET", f"/repos/{REPOSITORY}/releases?per_page=100&page={page}")
        require(isinstance(entries, list), "Invalid release listing")
        matches.extend(entry for entry in entries if entry.get("tag_name") == TAG)
        require(len(matches) <= 1, "Multiple release drafts use the requested tag")
        if len(entries) < 100:
            return matches[0] if matches else None
    raise ReleaseError("Unexpected release pagination")


def release_assets(github, release_id):
    result = []
    for page in range(1, 11):
        entries = github.json("GET", f"/repos/{REPOSITORY}/releases/{release_id}/assets?per_page=100&page={page}")
        require(isinstance(entries, list), "Invalid release asset listing")
        result.extend(entries)
        if len(entries) < 100:
            return result
    raise ReleaseError("Unexpected release asset pagination")


def verify_uploaded(github, metadata, name, path, workspace):
    require(metadata.get("name") == name and metadata.get("state") == "uploaded"
            and metadata.get("size") == path.stat().st_size, "Uploaded asset metadata mismatch: " + name)
    api_digest = metadata.get("digest")
    if api_digest:
        require(api_digest == "sha256:" + digest(path), "Uploaded asset digest mismatch: " + name)
    else:
        asset_id = metadata.get("id")
        require(type(asset_id) is int and asset_id > 0, "Invalid uploaded asset ID")
        destination = workspace / ("verify-" + str(asset_id))
        if destination.exists():
            destination.unlink()
        github.download(f"/repos/{REPOSITORY}/releases/assets/{asset_id}", destination)
        require(digest(destination) == digest(path), "Uploaded asset bytes mismatch: " + name)


def publish(github, request, notes, assets, workspace, validate_only=False):
    verify_default_workflows(github, request)
    notes = release_body(notes, request)
    source = request["source_commit"]
    target = tag_commit(github)
    require(target in {None, source}, "Existing tag points to another commit; it will not be replaced")
    release = find_release(github)
    existing = {}
    if release:
        require(target in {None, source} and release.get("tag_name") == TAG
                and release.get("target_commitish") == source
                and release.get("name") == TITLE and release.get("body") == notes
                and not release.get("prerelease"), "Existing release metadata differs from the reviewed release")
        for metadata in release_assets(github, release["id"]):
            name = metadata.get("name")
            require(name in assets and name not in existing, "Unexpected or duplicate existing release asset")
            verify_uploaded(github, metadata, name, assets[name], workspace)
            existing[name] = metadata
        if not release.get("draft"):
            require(target == source, "Published release tag does not identify the tested source")
            require(set(existing) == set(assets), "Published release is incomplete; refusing changes")
            print("Release already published with the reviewed assets; no changes made.")
            return
    if validate_only:
        print("All pre-publication checks passed; no release API writes requested.")
        return
    if release is None:
        release = github.json("POST", f"/repos/{REPOSITORY}/releases", {
            "tag_name": TAG, "target_commitish": source, "name": TITLE,
            "body": notes, "draft": True, "prerelease": False, "make_latest": "false",
        })
        require(release.get("draft") is True and release.get("tag_name") == TAG,
                "Release creation did not return the expected draft")
    release_id = release["id"]
    for name in sorted(assets):
        if name in existing:
            continue
        metadata = github.upload(release_id, name, assets[name])
        verify_uploaded(github, metadata, name, assets[name], workspace)
        print("Verified release asset: " + name)
    final_assets = release_assets(github, release_id)
    require(len(final_assets) == len(assets)
            and {entry.get("name") for entry in final_assets} == set(assets),
            "Final draft asset inventory differs from the reviewed set")
    for metadata in final_assets:
        name = metadata["name"]
        verify_uploaded(github, metadata, name, assets[name], workspace)
    require(tag_commit(github) in {None, source}, "Release tag changed before publication")
    verify_default_workflows(github, request)
    result = github.json("PATCH", f"/repos/{REPOSITORY}/releases/{release_id}",
                         {"draft": False, "make_latest": "true"})
    require(result.get("draft") is False and result.get("tag_name") == TAG
            and result.get("target_commitish") == source,
            "GitHub did not confirm release publication")
    require(tag_commit(github) == source, "Published tag does not identify the tested source")
    print("Published https://github.com/" + REPOSITORY + "/releases/tag/" + TAG)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", default=REQUEST_PATH)
    parser.add_argument("--validate-only", action="store_true")
    arguments = parser.parse_args()
    require(arguments.request == REQUEST_PATH, "Unexpected release request path")
    request = read_request(Path(arguments.request))
    notes = verify_checkout(request, os.environ)
    github = GitHub(os.environ.get("GITHUB_TOKEN"))
    artifacts = verify_build(github, request)
    with tempfile.TemporaryDirectory(prefix="unx-reviewed-release-") as temporary:
        workspace = Path(temporary)
        assets = collect_assets(github, request, artifacts, workspace)
        print(f"Verified successful build {request['build_run_id']} at {request['source_commit']} and all seven assets.")
        publish(github, request, notes, assets, workspace, arguments.validate_only)


if __name__ == "__main__":
    try:
        main()
    except (ReleaseError, OSError, zipfile.BadZipFile, UnicodeError) as error:
        # Messages are constructed without tokens or signed URLs. Unexpected API
        # or parsing failures leave an existing draft unpublished for safe retry.
        if isinstance(error, ReleaseError):
            print("Release refused: " + str(error), file=__import__("sys").stderr)
        else:
            print("Release refused: local file/archive processing failed", file=__import__("sys").stderr)
        raise SystemExit(1)
