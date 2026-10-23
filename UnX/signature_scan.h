#ifndef UNX_SIGNATURE_SCAN_H
#define UNX_SIGNATURE_SCAN_H

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace unx { namespace game_memory {

struct SignatureMatch {
  uint8_t* address;
  size_t   count;
};

// '?' marks a relocation, relative displacement, or another variable byte.
// A missing or ambiguous signature must never become a patch target.
inline SignatureMatch
ScanSignature (uint8_t* begin, size_t size, const uint8_t* bytes,
               const char* mask, size_t length)
{
  SignatureMatch result = { nullptr, 0 };
  if (begin == nullptr || bytes == nullptr || length == 0 || length > size)
    return result;
  if (mask != nullptr && std::strlen (mask) != length)
    return result;

  for (size_t offset = 0; offset <= size - length; ++offset)
  {
    bool matches = true;
    for (size_t index = 0; index < length; ++index)
    {
      if ((mask == nullptr || mask [index] != '?') &&
          begin [offset + index] != bytes [index])
      {
        matches = false;
        break;
      }
    }

    if (matches)
    {
      ++result.count;
      result.address = result.count == 1 ? begin + offset : nullptr;
    }
  }

  return result;
}

} }

#endif
