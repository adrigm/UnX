#include "../UnX/language_preferences.h"

#include <cassert>
#include <cstdio>
#include <string>

struct parameter_stub {
  std::wstring value;
  void store (const std::wstring& next) { value = next; }
};

int main ()
{
  using unx::language_preference;
  const wchar_t* legacy_values [] = { L"jp", L"us", L"en", L"", L"default", L"custom" };

  // The same save path used by UNX_SaveConfig must retain each persisted scope,
  // including legacy no-patch tokens and explicit empty master values.
  for (const wchar_t* master : legacy_values)
    for (const wchar_t* game_override : legacy_values)
    {
      language_preference preference;
      preference.master = master;
      preference.game_override = game_override;
      const std::wstring expected = *game_override == L'\0' ? master : game_override;
      assert (preference.effective () == expected);
      parameter_stub master_parameter;
      parameter_stub override_parameter;
      preference.save_to (master_parameter, override_parameter);
      assert (master_parameter.value == master);
      assert (override_parameter.value == game_override);
    }

  language_preference ffx;
  ffx.master = L"en";
  ffx.game_override = L"jp";
  parameter_stub persisted_master;
  parameter_stub persisted_ffx;
  ffx.save_to (persisted_master, persisted_ffx);
  assert (persisted_master.value == L"en");
  assert (persisted_ffx.value == L"jp");

  // Starting another game after an unrelated FFX save still inherits English
  // game assets rather than the Japanese FFX-only override.
  language_preference ffx2;
  ffx2.master = persisted_master.value;
  assert (ffx2.effective () == L"en");

  assert (ffx.game_selection () == 3);
  ffx.select_for_game (2);
  ffx.save_to (persisted_master, persisted_ffx);
  assert (persisted_master.value == L"en");
  assert (persisted_ffx.value == L"us");
  assert (ffx.effective () == L"us");

  ffx.select_for_game (0);
  assert (ffx.game_selection () == 0);
  assert (ffx.effective () == L"en");
  ffx.save_to (persisted_master, persisted_ffx);
  assert (persisted_ffx.value.empty ());
  assert (persisted_master.value == L"en");

  ffx.select_for_game (1);
  assert (ffx.game_selection () == 1 && ffx.game_override == L"en");
  ffx.select_for_game (3);
  assert (ffx.game_selection () == 3 && ffx.game_override == L"jp");
  ffx.select_for_game (999);
  assert (ffx.game_override == L"jp");
  assert (ffx2.effective () == L"en");

  language_preference compiled_defaults;
  assert (compiled_defaults.master == L"jp");
  assert (compiled_defaults.game_override.empty ());
  assert (compiled_defaults.effective () == L"jp");
  std::puts ("Language master/override isolation and legacy compatibility checks passed.");
}
