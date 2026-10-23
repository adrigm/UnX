#!/usr/bin/env python3
"""Offline release safety checks. No network or repository mutation."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import zipfile

spec = importlib.util.spec_from_file_location("publisher", Path(__file__).parents[1] / "scripts/publish-release.py")
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)
SOURCE = "1" * 40


class FakeGitHub:
    def __init__(self, release=None, tag=None):
        self.release = release
        self.tag = tag
        self.assets = []
        self.writes = []
        self.fail_upload = False

    def json(self, method, path, value=None, optional=False):
        if method == "GET":
            if "/git/ref/tags/" in path:
                return None if self.tag is None else {"object": {"type": "commit", "sha": self.tag}}
            if "/releases/tags/" in path:
                return self.release if self.release and not self.release.get("draft") else None
            if "/releases?" in path:
                return [] if self.release is None else [self.release]
            if "/assets?" in path:
                return self.assets.copy()
            raise AssertionError(path)
        self.writes.append((method, value))
        if method == "POST":
            self.release = {**value, "id": 10}
        elif method == "PATCH":
            self.release.update(value)
            self.tag = self.release["target_commitish"]
        else:
            raise AssertionError(method)
        return self.release.copy()

    def upload(self, release_id, name, path):
        self.writes.append(("UPLOAD", name))
        if self.fail_upload:
            raise publisher.ReleaseError("Simulated upload failure")
        metadata = {"id": len(self.assets) + 1, "name": name, "state": "uploaded",
                    "size": path.stat().st_size, "digest": "sha256:" + publisher.digest(path)}
        self.assets.append(metadata)
        return metadata


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.asset = self.root / "asset.zip"
        self.asset.write_bytes(b"reviewed bytes")
        self.assets = {"asset.zip": self.asset}
        self.request = {"source_commit": SOURCE, "build_run_id": 123}
        self.default_gate = mock.patch.object(publisher, "verify_default_workflows")
        self.default_gate.start()
        self.addCleanup(self.default_gate.stop)
        self.notes = "UnX 0.10.0 / Manager 1.0.1\n"

    def request_document(self):
        return {"tag": "v0.10.0", "mod_version": "0.10.0", "manager_version": "1.0.1",
                "source_commit": SOURCE, "build_run_id": 123, "notes_path": publisher.NOTES_PATH,
                "sha256": {f"asset{number}.zip": "a" * 64 for number in range(7)}}

    def test_request_rejects_ambiguous_json_keys_and_extra_fields(self):
        path = self.root / "request.json"
        path.write_text('{"tag":"v0.10.0","tag":"v0.10.0"}')
        with self.assertRaises(publisher.ReleaseError):
            publisher.read_request(path)
        request = self.request_document()
        path.write_text(json.dumps(request))
        self.assertEqual(publisher.read_request(path), request)
        request["unreviewed"] = True
        path.write_text(json.dumps(request))
        with self.assertRaises(publisher.ReleaseError):
            publisher.read_request(path)

    def test_archive_rejects_traversal_symlinks_and_ambiguous_basenames(self):
        for names in (("../outside",), ("a/file", "b/file")):
            path = self.root / "unsafe.zip"
            with zipfile.ZipFile(path, "w") as archive:
                for name in names:
                    archive.writestr(name, b"x")
            output = self.root / str(len(names))
            output.mkdir()
            with self.assertRaises(publisher.ReleaseError):
                publisher.extract_artifact(path, output)
        with zipfile.ZipFile(self.root / "link.zip", "w") as archive:
            link = zipfile.ZipInfo("link")
            link.create_system = 3
            link.external_attr = 0o120777 << 16
            archive.writestr(link, "outside")
        with zipfile.ZipFile(self.root / "link.zip") as archive:
            with self.assertRaises(publisher.ReleaseError):
                list(publisher.safe_zip_members(archive))

    def test_checksum_sidecar_binds_filename_and_bytes(self):
        sidecar = self.root / "asset.zip.sha256"
        files = {"asset.zip": self.asset, "asset.zip.sha256": sidecar}
        sidecar.write_text(publisher.digest(self.asset) + "  asset.zip\n")
        publisher.verify_sidecar(files, "asset.zip")
        sidecar.write_text(publisher.digest(self.asset) + "  other.zip\n")
        with self.assertRaises(publisher.ReleaseError):
            publisher.verify_sidecar(files, "asset.zip")

    def test_conflicting_tag_fails_before_any_write(self):
        github = FakeGitHub(tag="2" * 40)
        with self.assertRaises(publisher.ReleaseError):
            publisher.publish(github, self.request, self.notes, self.assets, self.root)
        self.assertEqual(github.writes, [])

    def test_validation_mode_performs_no_writes(self):
        github = FakeGitHub()
        publisher.publish(github, self.request, self.notes, self.assets, self.root, validate_only=True)
        self.assertEqual(github.writes, [])

    def test_failed_upload_leaves_draft_and_retry_does_not_replace_assets(self):
        github = FakeGitHub()
        github.fail_upload = True
        with self.assertRaises(publisher.ReleaseError):
            publisher.publish(github, self.request, self.notes, self.assets, self.root)
        self.assertTrue(github.release["draft"])
        self.assertFalse(any(method == "PATCH" for method, _ in github.writes))
        github.fail_upload = False
        publisher.publish(github, self.request, self.notes, self.assets, self.root)
        self.assertFalse(github.release["draft"])
        self.assertEqual(github.tag, SOURCE)
        before = github.writes.copy()
        publisher.publish(github, self.request, self.notes, self.assets, self.root)
        self.assertEqual(github.writes, before)

    def test_existing_wrong_asset_blocks_publication(self):
        github = FakeGitHub(release={"id": 10, "tag_name": publisher.TAG, "target_commitish": SOURCE,
                                    "name": publisher.TITLE, "body": publisher.release_body(self.notes, self.request),
                                    "draft": True, "prerelease": False})
        github.assets = [{"id": 1, "name": "asset.zip", "state": "uploaded",
                          "size": self.asset.stat().st_size, "digest": "sha256:" + "0" * 64}]
        with self.assertRaises(publisher.ReleaseError):
            publisher.publish(github, self.request, self.notes, self.assets, self.root)
        self.assertEqual(github.writes, [])

    def test_default_workflow_differences_refuse_before_release_writes(self):
        self.default_gate.stop()
        class RepositoryGitHub(FakeGitHub):
            def json(self, method, path, value=None, optional=False):
                if path == "/repos/" + publisher.REPOSITORY:
                    return {"default_branch": "master"}
                if "/commits/" in path:
                    return {"commit": {"tree": {"sha": "2" * 40}}}
                if "/git/trees/" in path:
                    return {"truncated": False, "tree": [{"type": "blob", "path": ".github/workflows/build.yml", "sha": "3" * 40}]}
                return super().json(method, path, value, optional=optional)
        github = RepositoryGitHub()
        with mock.patch.object(publisher, "git", return_value=b"100644 blob " + b"4" * 40 + b"\t.github/workflows/build.yml\0"):
            with self.assertRaisesRegex(publisher.ReleaseError, "default branch"):
                publisher.publish(github, self.request, self.notes, self.assets, self.root)
        self.assertEqual(github.writes, [])
        with mock.patch.object(publisher, "git", return_value=b"100644 blob " + b"3" * 40 + b"\t.github/workflows/build.yml\0"):
            publisher.verify_default_workflows(github, self.request)

    def test_release_body_records_the_exact_ci_run_and_source(self):
        body = publisher.release_body(self.notes, self.request)
        self.assertIn("https://github.com/adrigm/UnX/actions/runs/123", body)
        self.assertIn(SOURCE, body)
        self.assertIn("All seven published assets", body)

    def test_upload_uses_json_accept_and_binary_content_type(self):
        github = publisher.GitHub("test-secret")
        with mock.patch.object(github, "open") as opener:
            opener.return_value.__enter__.return_value.status = 201
            opener.return_value.__enter__.return_value.read.return_value = b'{}'
            github.upload(10, "asset.zip", self.asset)
        keywords = opener.call_args.kwargs
        self.assertEqual(keywords["content_type"], "application/octet-stream")
        self.assertNotIn("accept", keywords)  # open defaults to GitHub's JSON media type.

    def test_checkout_allows_publisher_only_recovery_without_product_changes(self):
        request = self.request_document()
        head = "2" * 40
        environment = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": publisher.REPOSITORY,
                       "GITHUB_REF": "refs/heads/" + publisher.BRANCH,
                       "GITHUB_EVENT_NAME": "push", "GITHUB_SHA": head}
        changes = [publisher.REQUEST_PATH, "scripts/publish-release.py", "tests/publish_release_test.py"]
        def git_output(*arguments):
            if arguments[0] == "rev-parse":
                return head.encode()
            if arguments[0] == "merge-base":
                return b""
            if arguments[0] == "diff":
                return "\n".join(changes).encode()
            if arguments == ("show", head + ":" + publisher.REQUEST_PATH):
                return json.dumps(request).encode()
            if arguments[0] == "show" and arguments[1].endswith(":launcher/package.json"):
                return b'{"version":"1.0.1"}'
            if arguments[0] == "show" and arguments[1].endswith(":launcher/payload-manifest.json"):
                return b'{"version":"0.10.0"}'
            if arguments[0] == "show" and arguments[1].endswith(":UnX/DLL_VERSION.H"):
                return b"#define UNX_MAJOR 0\n#define UNX_MINOR 10\n#define UNX_BUILD 0\n#define UNX_REV 0\n"
            if arguments[0] == "show" and arguments[1].endswith(":" + publisher.NOTES_PATH):
                return self.notes.encode()
            raise AssertionError(arguments)
        with mock.patch.object(publisher, "git", side_effect=git_output):
            self.assertEqual(publisher.verify_checkout(request, environment), self.notes)
            changes.append("UnX/config.cpp")
            with self.assertRaisesRegex(publisher.ReleaseError, "new verified build"):
                publisher.verify_checkout(request, environment)
            changes[:] = ["scripts/publish-release.py"]
            with self.assertRaises(publisher.ReleaseError):
                publisher.verify_checkout(request, environment)

    def test_actual_artifact_headers_and_redirect_keep_token_on_api_only(self):
        class Response(io.BytesIO):
            def __init__(self, status, value=b"", location=None):
                super().__init__(value)
                self.status = status
                self.headers = {} if location is None else {"Location": location}
        github = publisher.GitHub("test-secret")
        signed_url = "https://productionresults.blob.core.windows.net/archive?signature=private"
        calls = []
        def transport(request, timeout):
            calls.append(request)
            return (Response(302, location=signed_url) if len(calls) == 1
                    else Response(200, b"artifact"))
        with mock.patch.object(github.opener, "open", side_effect=transport):
            github.download("/repos/adrigm/UnX/actions/artifacts/123/zip", self.root / "artifact")
        self.assertEqual(calls[0].get_header("Accept"), "application/vnd.github+json")
        self.assertEqual(calls[0].get_header("Authorization"), "Bearer test-secret")
        self.assertEqual(calls[1].get_header("Accept"), "application/octet-stream")
        self.assertIsNone(calls[1].get_header("Authorization"))
        self.assertEqual((self.root / "artifact").read_bytes(), b"artifact")

    def test_actual_release_asset_headers_request_binary(self):
        class Response(io.BytesIO):
            status = 200
            headers = {}
        github = publisher.GitHub("test-secret")
        with mock.patch.object(github.opener, "open", return_value=Response(b"asset")) as transport:
            github.download("/repos/adrigm/UnX/releases/assets/123", self.root / "asset")
        self.assertEqual(transport.call_args.args[0].get_header("Accept"), "application/octet-stream")

    def test_http_errors_identify_api_path_without_tokens_or_signed_urls(self):
        github = publisher.GitHub("test-secret")
        path = "/repos/adrigm/UnX/actions/artifacts/123/zip"
        error = publisher.urllib.error.HTTPError("https://api.github.com" + path, 415, "error", {}, None)
        with mock.patch.object(github.opener, "open", side_effect=error):
            with self.assertRaisesRegex(publisher.ReleaseError, "artifacts/123/zip.*415") as caught:
                github.download(path, self.root / "error")
        self.assertNotIn("test-secret", str(caught.exception))
        signed_url = "https://release-assets.githubusercontent.com/archive?signature=private"
        error = publisher.urllib.error.HTTPError(signed_url, 415, "error", {}, None)
        with mock.patch.object(github.opener, "open", side_effect=error):
            with self.assertRaises(publisher.ReleaseError) as caught:
                github.open("GET", signed_url, authenticated=False)
        self.assertIn("[signed binary download]", str(caught.exception))
        self.assertNotIn("private", str(caught.exception))
        self.assertNotIn("githubusercontent", str(caught.exception))

    def test_download_redirect_never_forwards_auth(self):
        class Response(io.BytesIO):
            def __init__(self, status, value=b"", location=None):
                super().__init__(value)
                self.status = status
                self.headers = {} if location is None else {"Location": location}
        github = publisher.GitHub("test-secret")
        calls = []
        def opener(method, url, **options):
            calls.append(options.get("authenticated", True))
            return (Response(302, location="https://release-assets.githubusercontent.com/blob?signature=private")
                    if len(calls) == 1 else Response(200, b"asset"))
        github.open = opener
        github.download("/repos/adrigm/UnX/releases/assets/123", self.root / "download")
        self.assertEqual(calls, [True, False])
        self.assertEqual((self.root / "download").read_bytes(), b"asset")


if __name__ == "__main__":
    unittest.main()
