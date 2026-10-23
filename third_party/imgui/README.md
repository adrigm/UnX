These are the unmodified Dear ImGui 1.50 headers and MIT license from
https://github.com/ocornut/imgui/tree/5e1caaaef3953091b5395cbeb17c67548d542801.

UnX calls the ImGui implementation exported by its legacy Special K `dxgi.dll`;
it must not compile a second ImGui implementation into the plugin. The legacy
Special K 0.8.60.2 DLL identifies its ImGui as `1.50 WIP`. The 1.50 public API
used by UnX has matching exported C++ signatures. A current ImGui header is not
compatible with this ABI. `UnX/specialk_imgui.h` declares the `IsItemFocused`
extension exported by the bundled Special K runtime.
