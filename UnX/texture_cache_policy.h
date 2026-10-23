#ifndef UNX_TEXTURE_CACHE_POLICY_H
#define UNX_TEXTURE_CACHE_POLICY_H

namespace unx {
namespace compatibility {

// The legacy Special K texture cache crashes startup under Wine/Proton.
// Keep injection available and preserve the native Windows choice.
inline bool TextureCacheEnabled (bool requested, bool wine_runtime)
{
  return requested && ! wine_runtime;
}

} // namespace compatibility
} // namespace unx

#endif
