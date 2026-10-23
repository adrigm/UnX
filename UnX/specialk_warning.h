#ifndef UNX_SPECIALK_WARNING_H
#define UNX_SPECIALK_WARNING_H

#include <cwchar>

namespace unx { namespace compatibility {

const wchar_t legacy_xinput_warning [] =
  L"Problematic XInput software detected (infinite haptic feedback loop), please restart the Steam client.";

inline bool
SuppressLegacyXInputWarning (const wchar_t* text, bool injector_caller)
{
  return injector_caller && text != nullptr &&
         std::wcscmp (text, legacy_xinput_warning) == 0;
}

} }

#endif
