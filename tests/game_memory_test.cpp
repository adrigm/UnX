#include "../UnX/game_memory.h"

#include <cassert>
#include <cstdio>

volatile int writable_image_global = 7;

int main ()
{
  namespace memory = unx::game_memory;
  memory::ExecutableImage image;
  assert (memory::GetExecutableImage (image));
  assert (image.base == reinterpret_cast <uint8_t*> (GetModuleHandle (nullptr)));
  assert (memory::IsWritableImageAddress (
    const_cast <int*> (&writable_image_global), sizeof writable_image_global));

  int stack_value = 0;
  assert (memory::IsWritable (&stack_value, sizeof stack_value));
  assert (! memory::IsWritableImageAddress (&stack_value, sizeof stack_value));
  assert (! memory::IsReadable (nullptr, 1));
  assert (! memory::IsReadable (&stack_value, 0));
  assert (! memory::IsReadable (reinterpret_cast <void*> (~uintptr_t (0) - 1), 8));

  uint8_t* page = static_cast <uint8_t*> (
    VirtualAlloc (nullptr, 8192, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE));
  assert (page != nullptr);
  assert (memory::IsReadable (page, 8192));
  assert (memory::IsWritable (page, 8192));
  DWORD old = 0;
  assert (VirtualProtect (page + 4096, 4096, PAGE_READONLY, &old));
  assert (memory::IsReadable (page + 4092, 8));
  assert (! memory::IsWritable (page + 4092, 8));
  assert (VirtualProtect (page + 4096, 4096, PAGE_NOACCESS, &old));
  assert (! memory::IsReadable (page + 4092, 8));
  assert (VirtualFree (page, 0, MEM_RELEASE));
  std::puts ("Windows image and page validation checks passed.");
}
