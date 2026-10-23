#include "../UnX/texture_cache_policy.h"

#include <cassert>
#include <cstdio>

int main ()
{
  using unx::compatibility::TextureCacheEnabled;

  // Native Windows keeps both existing user choices.
  assert (TextureCacheEnabled (true, false));
  assert (! TextureCacheEnabled (false, false));

  // A stale INI or a later attempt to enable the cache cannot bypass the
  // compatibility policy under Wine/Proton.
  assert (! TextureCacheEnabled (true, true));
  assert (! TextureCacheEnabled (false, true));
  const bool requests [] = { true, false, true, true, false };
  for (bool requested : requests)
  {
    const bool windows_value = TextureCacheEnabled (requested, false);
    const bool wine_value = TextureCacheEnabled (requested, true);
    assert (windows_value == requested);
    assert (! wine_value);
    assert (TextureCacheEnabled (windows_value, false) == windows_value);
    assert (TextureCacheEnabled (wine_value, true) == wine_value);
  }

  std::puts ("Wine texture-cache policy and native Windows preference checks passed.");
}
