#include "../UnX/specialk_warning.h"

#include <cassert>
#include <cstdio>
#include <string>

int main ()
{
  namespace compatibility = unx::compatibility;
  const wchar_t* warning = compatibility::legacy_xinput_warning;
  assert (compatibility::SuppressLegacyXInputWarning (warning, true));
  assert (! compatibility::SuppressLegacyXInputWarning (warning, false));
  assert (! compatibility::SuppressLegacyXInputWarning (nullptr, true));
  assert (! compatibility::SuppressLegacyXInputWarning (L"", true));
  assert (! compatibility::SuppressLegacyXInputWarning (L"Other Special K warning", true));
  assert (! compatibility::SuppressLegacyXInputWarning (L"Problematic XInput software detected", true));
  std::wstring suffix = std::wstring (warning) + L" Different warning.";
  assert (! compatibility::SuppressLegacyXInputWarning (suffix.c_str (), true));
  std::puts ("Selective legacy XInput warning filter checks passed.");
}
