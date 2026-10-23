#pragma once

// Special K's ImGui 1.50 WIP includes the keyboard-navigation extension.
// This public entry point is exported by its DLL but is absent from the
// upstream 1.50 header. Keep the extension separate from the vendor headers.
namespace ImGui
{
  IMGUI_API bool IsItemFocused (void);
}
