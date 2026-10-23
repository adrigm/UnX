#ifndef UNX_LANGUAGE_PREFERENCES_H
#define UNX_LANGUAGE_PREFERENCES_H

#include <string>

namespace unx {

// Persisted defaults and game overrides are distinct from the effective value
// used for asset patching. Saving unrelated settings must not merge the two.
struct language_preference {
  std::wstring master = L"jp";
  std::wstring game_override;

  const std::wstring& effective () const
  {
    return game_override.empty () ? master : game_override;
  }

  int game_selection () const
  {
    if (game_override.empty ()) return 0;
    if (game_override == L"us") return 2;
    if (game_override == L"jp") return 3;
    return 1; // en/default/other legacy values leave the game assets unchanged.
  }

  void select_for_game (int selection)
  {
    switch (selection)
    {
      case 0: game_override.clear (); break;
      case 1: game_override = L"en"; break;
      case 2: game_override = L"us"; break;
      case 3: game_override = L"jp"; break;
      default: break;
    }
  }

  template <typename Parameter>
  void save_to (Parameter& master_parameter, Parameter& override_parameter) const
  {
    master_parameter.store (master);
    override_parameter.store (game_override);
  }
};

} // namespace unx

#endif
