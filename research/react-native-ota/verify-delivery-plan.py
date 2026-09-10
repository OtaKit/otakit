"""Executable examples of the delivery design, not production SDK/API tests.

Run: python3 research/react-native-ota/verify-delivery-plan.py
No network, dependencies, repository writes, native builds, or live services.
Unicode examples use Python's reported Unicode database; production must pin
one normalization/case-folding contract and run shared cross-language vectors.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from hashlib import sha256
from io import BytesIO
import json
import unicodedata
import unittest
from urllib.parse import quote
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile


def portable_key(value):
    return unicodedata.normalize("NFC", unicodedata.normalize("NFC", value).casefold())


def validate_paths(paths):
    spellings, files, directories = {}, set(), set()
    reserved = {"bundle.json", "otakit_files.json", "otakit-embedded.json"}
    if len(paths) > 5000:
        raise ValueError("Too many files")
    for path in paths:
        path.encode("utf-8")  # Reject unpaired surrogate code points.
        parts = path.split("/")
        if (
            not path
            or len(path) > 512
            or "\\" in path
            or any(part in ("", ".", "..") for part in parts)
            or any(ord(char) < 32 or ord(char) == 127 for char in path)
        ):
            raise ValueError("Invalid path")
        for index in range(1, len(parts) + 1):
            prefix = "/".join(parts[:index])
            key = portable_key(prefix)
            if index == 1 and key in reserved:
                raise ValueError("Reserved path")
            if key in spellings and spellings[key] != prefix:
                raise ValueError("Ambiguous spelling")
            spellings[key] = prefix
            if index < len(parts):
                if key in files:
                    raise ValueError("File used as directory")
                directories.add(key)
            else:
                if key in files or key in directories:
                    raise ValueError("Duplicate file or directory conflict")
                files.add(key)


def content_hash(files):
    validate_paths(files)
    ordered = sorted(files, key=lambda path: path.encode("utf-8"))
    canonical = "\n".join(f"{path}:{sha256(files[path]).hexdigest()}" for path in ordered)
    return sha256(canonical.encode("utf-8")).hexdigest()


def archive(files, compression):
    output = BytesIO()
    with ZipFile(output, "w", compression=compression) as zipped:
        for path, data in files.items():
            zipped.writestr(path, data)
    return output.getvalue()


@dataclass(frozen=True)
class Variant:
    app: str = "app-a"
    framework: str = "react-native"
    platform: str = "ios"
    runtime: str | None = "ios-runtime-a"
    version: str = "1.4.2"

    def key(self):
        if self.framework == "capacitor" and self.platform == "cross":
            return self.app, self.version
        if self.framework != "react-native" or self.platform not in ("ios", "android") or not self.runtime:
            raise ValueError("Invalid framework/platform/runtime")
        return self.app, self.platform, self.runtime, self.version


def release_lane(bundle, *, platform, runtime, channel):
    bundle.key()
    if (platform, runtime) != (bundle.platform, bundle.runtime):
        raise ValueError("Release targeting differs from bundle")
    return bundle.app, platform, channel, runtime


def manifest_path(bundle, channel):
    bundle.key()
    parts = ["manifests", bundle.app]
    if bundle.framework == "react-native":
        parts += ["v3", bundle.platform]
    parts += [channel or "__base__", bundle.runtime or "__default__", "manifest.json"]
    return "/".join(quote(part, safe="") for part in parts)


def select(manifest, device, current_hash, *, trial=False, eligible=True, failed_hashes=()):
    """Signature validity is an input assumption, not a cryptographic verifier."""
    if manifest is None:
        return "keep-current"
    if not manifest["signature_valid"] or any(
        manifest[key] != device[key]
        for key in ("app", "framework", "platform", "runtime", "channel")
    ):
        return "reject"
    if manifest["contentHash"] in failed_hashes:
        return "reject"
    if trial:
        return "keep-trial"
    if manifest["contentHash"] == current_hash:
        return "associate-only"
    if manifest["contentHash"] == device["embeddedContentHash"]:
        return "reload-embedded" if eligible else "stage-embedded"
    return "find-cached-or-download"


def publish_once(current, receipt, lane, release_id, expected):
    if lane in receipt:
        return  # A completed operation is not republished after a later release.
    if current.get(lane) != expected:
        raise ValueError("Current release changed")
    current[lane] = release_id
    receipt[lane] = release_id


class DeliveryPlanChecks(unittest.TestCase):
    def setUp(self):
        self.files = {
            "otakit-bundle.json": json.dumps({"platform": "ios", "runtimeVersion": "ios-runtime-a", "version": "1.4.2"}).encode(),
            "index.bundle": b"final Hermes output fixture" * 64,
            "assets/logo.png": b"image fixture",
        }
        self.digest = content_hash(self.files)
        self.device = dict(app="app-a", framework="react-native", platform="ios", runtime="ios-runtime-a", channel="production", embeddedContentHash=self.digest)
        self.manifest = {key: self.device[key] for key in ("app", "framework", "platform", "runtime", "channel")}
        self.manifest.update(contentHash=self.digest, signature_valid=True, releaseId="baseline-release")

    def test_same_version_supports_several_native_environments(self):
        ios = Variant()
        variants = [ios, replace(ios, runtime="ios-runtime-b"), replace(ios, platform="android", runtime="android-runtime-a")]
        self.assertEqual(len({item.key() for item in variants}), 3)
        self.assertEqual({item.version for item in variants}, {"1.4.2"})
        self.assertEqual(ios.key(), replace(ios).key())

    def test_capacitor_keeps_old_version_uniqueness(self):
        cap = Variant(framework="capacitor", platform="cross", runtime=None)
        self.assertEqual(cap.key(), replace(cap, runtime="another-runtime").key())
        for invalid in [replace(cap, platform="ios"), replace(Variant(), platform="cross"), replace(Variant(), runtime=None)]:
            with self.assertRaises(ValueError):
                invalid.key()

    def test_release_cannot_reassign_bundle_runtime_or_platform(self):
        bundle = Variant()
        self.assertEqual(release_lane(bundle, platform=bundle.platform, runtime=bundle.runtime, channel="beta"), ("app-a", "ios", "beta", "ios-runtime-a"))
        for platform, runtime in [("android", bundle.runtime), ("ios", "ios-runtime-b")]:
            with self.assertRaises(ValueError):
                release_lane(bundle, platform=platform, runtime=runtime, channel="beta")

    def test_capacitor_uses_one_unchanged_manifest_path(self):
        cap = Variant(framework="capacitor", platform="cross", runtime=None)
        self.assertEqual(manifest_path(cap, "production"), "manifests/app-a/production/__default__/manifest.json")

    def test_app_prefix_covers_both_protocols(self):
        ios = Variant()
        own_paths = [manifest_path(ios, "production"), manifest_path(replace(ios, platform="android"), "beta"), manifest_path(Variant(framework="capacitor", platform="cross", runtime=None), None)]
        other = manifest_path(replace(ios, app="app-ab"), "production")
        deleted = [path for path in own_paths + [other] if path.startswith("manifests/app-a/")]
        self.assertEqual(deleted, own_paths)

    def test_content_identity_is_independent_of_zip_compression(self):
        archives = [archive(self.files, kind) for kind in [ZIP_STORED, ZIP_DEFLATED]]
        self.assertNotEqual(sha256(archives[0]).digest(), sha256(archives[1]).digest())
        for data in archives:
            with ZipFile(BytesIO(data)) as zipped:
                unpacked = {path: zipped.read(path) for path in zipped.namelist()}
            self.assertEqual(content_hash(unpacked), self.digest)
        self.assertEqual(content_hash(dict(reversed(list(self.files.items())))), self.digest)

    def test_content_identity_includes_descriptor_assets_and_expo_files(self):
        for path in self.files:
            with self.subTest(path=path):
                self.assertNotEqual(content_hash({**self.files, path: b"changed"}), self.digest)
        for path in ["expo-config.json", "www.bundle/component.html"]:
            self.assertNotEqual(content_hash({**self.files, path: b"new"}), self.digest)

    def test_native_receipt_is_outside_its_own_payload(self):
        with self.assertRaises(ValueError):
            content_hash({**self.files, "otakit-embedded.json": self.digest.encode()})

    def test_fresh_embedded_baseline_needs_only_publication_association(self):
        self.assertEqual(select(self.manifest, self.device, self.digest), "associate-only")
        self.assertEqual(select({**self.manifest, "releaseId": "new-release"}, self.device, self.digest), "associate-only")

    def test_rollback_uses_embedded_resources_and_obeys_activation_guard(self):
        self.assertEqual(select(self.manifest, self.device, "current-ota"), "reload-embedded")
        self.assertEqual(select(self.manifest, self.device, "current-ota", eligible=False), "stage-embedded")
        self.assertEqual(select(self.manifest, self.device, "current-ota", trial=True), "keep-trial")

    def test_other_binary_baseline_is_not_mistaken_for_own_embedded_copy(self):
        manifest = {**self.manifest, "contentHash": "other-baseline-content"}
        self.assertEqual(select(manifest, self.device, "current-ota"), "find-cached-or-download")

    def test_invalid_target_or_signature_cannot_take_embedded_shortcut(self):
        for key in ("app", "framework", "platform", "runtime", "channel"):
            with self.subTest(field=key):
                self.assertEqual(select({**self.manifest, key: "wrong"}, self.device, self.digest), "reject")
        self.assertEqual(select({**self.manifest, "signature_valid": False}, self.device, self.digest), "reject")
        self.assertEqual(select(None, self.device, "current-ota"), "keep-current")

    def test_failed_publication_cannot_retrigger_an_embedded_trial(self):
        self.assertEqual(select(self.manifest, self.device, "current-ota", failed_hashes=(self.digest,)), "reject")
        self.assertEqual(select(None, self.device, self.digest, failed_hashes=(self.digest,)), "keep-current")

    def test_portable_paths_reject_aliases_and_tree_conflicts(self):
        cases = [
            ["Icons/Back.png", "icons/back.png"],
            ["Icons/a.png", "icons/b.png"],
            ["caf\u00e9.ttf", "cafe\u0301.ttf"],
            ["stra\u00dfe.png", "STRASSE.png"],
            ["a", "a/b"], ["a/b", "a"], ["a", "a"],
            ["BUNDLE.JSON"], ["OTAKIT_FILES.JSON"], ["../index.bundle"], ["bad\ud800.png"],
        ]
        for paths in cases:
            with self.subTest(paths=paths), self.assertRaises(ValueError):
                validate_paths(paths)
        validate_paths(["index.bundle", "assets/a.png", "assets/caf\u00e9.ttf"])

    def test_retry_preserves_finished_variants_and_detects_changed_lanes(self):
        ios = ("app-a", "ios", "production", "ios-runtime-a")
        android = ("app-a", "android", "production", "android-runtime-a")
        current, receipt = {ios: "baseline-i", android: "baseline-a"}, {}
        publish_once(current, receipt, ios, "fix-i", "baseline-i")
        current[ios] = "later-i"
        publish_once(current, receipt, ios, "fix-i", "baseline-i")
        self.assertEqual(current[ios], "later-i")
        current[android] = "another-publisher"
        with self.assertRaises(ValueError):
            publish_once(current, receipt, android, "fix-a", "baseline-a")
        self.assertEqual(current[android], "another-publisher")
        self.assertNotIn(android, receipt)


if __name__ == "__main__":
    print(f"Design examples only; Python Unicode {unicodedata.unidata_version}.", flush=True)
    unittest.main(verbosity=2)
