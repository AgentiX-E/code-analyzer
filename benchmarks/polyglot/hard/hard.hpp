// A C++ header whose declarations live one namespace deep, which is where every C++ library puts them.
//
// **The brace is the point.** `namespace ui {` raises the depth exactly as `extern "C" {` does, and a scanner that
// reads declarations at depth zero only answers a namespaced header with nothing - **which is the answer that made a
// namespace a language feature rather than a punctuation mark.** The two functions below are what the file declares.

#pragma once

namespace ui {

int area(int width, int height);
int perimeter(int width, int height);

}  // namespace ui
