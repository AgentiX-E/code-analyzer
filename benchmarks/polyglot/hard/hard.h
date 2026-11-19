/*
 * A plugin header, which is what a C review files comments against.
 *
 * **Every declaration below is a construct a reviewer meets**: an opaque handle, a `#define` limit, a `static inline`
 * prototype, an argument list that wraps, and the `extern "C"` block every header that C++ also includes is written
 * inside. **The names this file declares are the five prototypes and the typedef**, and before §94 this repository's
 * scanner answered it with **zero** - the linkage block raised the brace depth and every declaration inside it was
 * skipped.
 */

#ifndef PANEL_H
#define PANEL_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/** An opaque handle; the caller never sees the fields. */
typedef struct panel_state panel_state_t;

/** The most rows any panel may hold. */
#define PANEL_MAX_ROWS 512

/* A row count is clamped here rather than at every call site. */
static inline int panel_clamp(int rows);

int panel_open(panel_state_t * state, size_t rows);
void panel_close(panel_state_t * state);
const char * panel_name(const panel_state_t * state);
int panel_resize(panel_state_t * state, size_t rows, int flags);
void panel_paint(panel_state_t * state, int x, int y, int width,
                 int height);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* PANEL_H */
