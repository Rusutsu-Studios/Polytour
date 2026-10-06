<!-- bump: minor -->

### Added

- Inspect the 3D board with wheel, keyboard and two-finger zoom from 80% to 200%,
  gentle horizontal/vertical orbit from a low to overhead view and Shift-drag pan.
  Keep magnification fixed while orbiting; the wheel and zoom controls change it.
  Save zoom and view lock with the other personal settings on this device, and
  reset zoom, rotation and pan from the game toolbar or Video settings (#129).
- Adjust streamer mode beside Language in the shared personal settings panel,
  before and during a match; keep the welcome and match toolbar shortcuts, with
  a target-shaped Reset board view control beside the match shortcut.

### Fixed

- Keep the welcome and invitation board preview at the full height of its stage.
- Give the lobby board more desktop space beside the compact player controls.
- Preserve ordinary tile clicks and keep floating controls separate from board
  gestures, including when holding the roll button.
- Zoom the board with laptop trackpad pinches without magnifying the browser
  page, including over its empty background, while preserving deliberate browser
  zoom shortcuts.
- Keep touch and trackpad pinches from magnifying the page when board view is
  locked.
- Stabilize pause-resume timing and small-screen settings checks in CI while
  retaining strict deadline, visibility and layout assertions.
