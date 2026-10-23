#include "../UnX/signature_scan.h"

#include <cassert>
#include <cstdio>

int main ()
{
  using unx::game_memory::ScanSignature;
  uint8_t bytes [] = { 0x11, 0x22, 0x33, 0x44, 0x55 };
  const uint8_t start [] = { 0x11, 0x22 };
  const uint8_t end [] = { 0x44, 0x55 };
  const uint8_t missing [] = { 0xff, 0xff };
  const uint8_t wildcard [] = { 0x22, 0xff, 0x44 };

  auto match = ScanSignature (bytes, sizeof bytes, start, nullptr, sizeof start);
  assert (match.count == 1 && match.address == bytes);
  match = ScanSignature (bytes, sizeof bytes, end, "xx", sizeof end);
  assert (match.count == 1 && match.address == bytes + 3);
  match = ScanSignature (bytes, sizeof bytes, missing, nullptr, sizeof missing);
  assert (match.count == 0 && match.address == nullptr);
  match = ScanSignature (bytes, sizeof bytes, wildcard, "x?x", sizeof wildcard);
  assert (match.count == 1 && match.address == bytes + 1);

  uint8_t repeated [] = { 0x11, 0x11, 0x11 };
  const uint8_t pair [] = { 0x11, 0x11 };
  match = ScanSignature (repeated, sizeof repeated, pair, nullptr, sizeof pair);
  assert (match.count == 2 && match.address == nullptr);
  match = ScanSignature (repeated, sizeof repeated, pair, "??", sizeof pair);
  assert (match.count == 2 && match.address == nullptr);

  assert (ScanSignature (nullptr, 5, start, nullptr, 2).count == 0);
  assert (ScanSignature (bytes, 5, nullptr, nullptr, 2).count == 0);
  assert (ScanSignature (bytes, 5, start, nullptr, 0).count == 0);
  assert (ScanSignature (bytes, 1, start, nullptr, 2).count == 0);
  assert (ScanSignature (bytes, 5, start, "x", 2).count == 0);
  assert (ScanSignature (bytes, 5, start, "xxx", 2).count == 0);

  std::puts ("Signature scanner checks passed.");
}
