# Studio visual theme

This package provides the shared Studio palette, semantic tokens and layout styling for Desktop clients.

The Studio keeps its existing navigation, work area and right assistant layout.
The writing workspace retains its chapter directory, editor and chapter assistant.
Navigation collapse, assistant drawers, independent scrolling and responsive
breakpoints continue to belong to the existing shell and workspaces.

Navigation defaults to a 56px icon rail and expands to 200px. The v2 shell
preference applies this compact default once to older layouts while retaining
the assistant preference; later manual expansion/collapse choices are saved.
Collapsed navigation uses portaled tooltips with zero hover/focus delay and
no fade-in. Each link has an explicit accessible name. The macOS titlebar
reserves space for its native window controls independently of the rail.

`src/styles/nexta-tokens.css` owns the reference colors in both appearances:

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#ffffff` | `#161616` |
| Surface | `#ffffff` | `#1e1e1e` |
| Sidebar | `#f7f7f7` | `#1b1b1b` |
| Text | `#191919` | `#e8e8e8` |
| Secondary text | `#737373` | `#8c8c8c` |
| Divider | `#efefef` | `#2a2a2a` |
| Input border | `#d9d9d9` | `#3a3a3a` |
| Brand | `#1f5c46` | `#6fc3a0` |
| Brand tint | `#edf4f0` | `#1b2a24` |

`design-platform.css` maps existing `--dsw-*` semantic roles onto that palette,
so independently loaded business clients share the same appearance. The static
source scale remains available for code and diff rendering. Controls use 8px
corners, elevated cards 16px, embedded panels 12px, dialogs 16px and badges 6px. The default font stack starts
with Inter and retains the user's custom font settings.

The `--studio-gradient-*` and `--studio-shadow-*` material tokens derive soft
gradients and elevation from the same reference palette. The page canvas has
a restrained mint wash, featured content uses a green-to-surface gradient,
and navigation, cards and the assistant composer have distinct surfaces.
The prose editor stays flat and quiet. These materials follow explicit theme
selection and the shell's existing reduced-motion preference.

ThemeRuntime controls `body[data-ds-dark-theme]`; the reference's operating-system
media query is represented by the existing system preference handling. Explicit
light and dark preferences therefore continue to work independently of the OS.
The boot document and native Electron window use matching canvas colors.

Reference controls have 1px borders and green focus feedback. Legacy embedded
components retain their hairline stroke contract. Scrollbar elevation checks use
semantic surface roles because reference surfaces can share the same color.

Visual review artifacts and verification logs for this change are under
`dramaip/build/nexta-ui-review/`, `dramaip/build/nexta-ui-refinement/` and
`dramaip/build/nexta-ui-*.log`.
