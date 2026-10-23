"""Check the actual C++ signatures against local PE files without loading them."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import re
import struct


def signatures(source: Path):
    text = re.sub(r"//[^\n]*|/\*.*?\*/", "", source.read_text(), flags=re.S)
    arrays = re.findall(
        r"\buint8_t\s+(\w+_signature)\s*\[\s*\]\s*=\s*\{([^}]+)\}", text
    )
    result = {}
    for name, body in arrays:
        values = re.findall(r"0x[0-9a-fA-F]+|\b\d+\b", body)
        pattern = bytes(int(value, 0) for value in values)
        mask_name = name.removesuffix("_signature") + "_mask"
        mask_match = re.search(
            rf'\bchar\s+{mask_name}\s*\[\s*\]\s*=\s*"([x?]+)"', text
        )
        if mask_match is None:
            mask_match = re.search(rf'\b{name}\s*,\s*"([x?]+)"', text)
        mask = mask_match[1] if mask_match else "x" * len(pattern)
        if not pattern or len(mask) != len(pattern):
            raise ValueError(f"Invalid signature/mask length: {source.name}:{name}")
        result[name] = (pattern, mask)
    if not result:
        raise ValueError(f"No signatures found in {source}")
    return result


def match_offsets(data: bytes, pattern: bytes, mask: str):
    expression = b"".join(
        b"." if wildcard == "?" else re.escape(bytes((value,)))
        for value, wildcard in zip(pattern, mask)
    )
    return [match.start() for match in re.finditer(b"(?=" + expression + b")", data, re.S)]


def fixture_checks(patterns):
    for name, (pattern, mask) in patterns.items():
        varied = bytes(
            value ^ 0x5A if wildcard == "?" else value
            for value, wildcard in zip(pattern, mask)
        )
        # A moved function and changed relocation operands must still match.
        padding = bytes([0xCC]) * 137
        assert match_offsets(padding + varied, pattern, mask) == [137], name
        # Both ambiguous matches and a truncated instruction must be detected.
        assert len(match_offsets(varied + padding + varied, pattern, mask)) == 2, name
        assert not match_offsets(varied[:-1], pattern, mask), name
        changed = bytearray(varied)
        exact = next(index for index, wildcard in enumerate(mask) if wildcard == "x")
        changed[exact] ^= 0xFF
        assert not match_offsets(bytes(changed), pattern, mask), name
    print(f"Synthetic moved/relocated/duplicate/truncated checks passed ({len(patterns)} signatures).")


def pe_executable_sections(data: bytes):
    if len(data) < 64 or data[:2] != b"MZ":
        raise ValueError("Invalid DOS header")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if pe + 24 > len(data) or data[pe : pe + 4] != b"PE\0\0":
        raise ValueError("Invalid PE header")
    machine, count = struct.unpack_from("<HH", data, pe + 4)
    optional_size = struct.unpack_from("<H", data, pe + 20)[0]
    if machine != 0x14C or optional_size < 96:
        raise ValueError("Expected a 32-bit x86 PE executable")
    table = pe + 24 + optional_size
    if table + count * 40 > len(data):
        raise ValueError("Truncated section table")
    for index in range(count):
        section = table + index * 40
        virtual_size, rva, raw_size, raw = struct.unpack_from("<IIII", data, section + 8)
        flags = struct.unpack_from("<I", data, section + 36)[0]
        if flags & 0x20000000:
            size = min(virtual_size, raw_size)
            if raw + size > len(data):
                raise ValueError("Truncated executable section")
            yield rva, data[raw : raw + size]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("game_directory", type=Path, nargs="?")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    shared = signatures(repo / "UnX" / "game_signatures.h")
    quickload = signatures(repo / "UnX" / "window.cpp")
    ffx = {name: value for name, value in shared.items() if not name.startswith("ffx2_")}
    ffx.update(quickload)
    ffx2 = {name: value for name, value in shared.items() if name.startswith("ffx2_")}
    fixture_checks(shared | quickload)
    if args.game_directory is None:
        return

    failures = []
    for stem, patterns in (("FFX", ffx), ("FFX-2", ffx2)):
        if not patterns:
            raise ValueError(f"No {stem} patterns were extracted")
        files = [args.game_directory / f"{stem}.exe"]
        backup = args.game_directory / f"{stem}_LAUnaware.bak"
        if backup.exists():
            files.append(backup)
        for binary in files:
            data = binary.read_bytes()
            sections = list(pe_executable_sections(data))
            print(f"{binary.name} SHA256 {hashlib.sha256(data).hexdigest()}")
            for name, (pattern, mask) in patterns.items():
                matches = [
                    rva + offset
                    for rva, section in sections
                    for offset in match_offsets(section, pattern, mask)
                ]
                print(f"  {name}: {len(matches)} match(es), RVA " +
                      ", ".join(f"0x{rva:X}" for rva in matches))
                if len(matches) != 1:
                    failures.append(f"{binary.name}:{name} ({len(matches)} matches)")
    if failures:
        raise SystemExit("Signature validation failed: " + "; ".join(failures))
    print("All local executable signatures are unique. No game binary was executed or modified.")


if __name__ == "__main__":
    main()
