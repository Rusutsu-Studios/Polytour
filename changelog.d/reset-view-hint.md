### Changed

- The reset view button on the board toolbar now explains itself with the
  shared help bubble on hover and on keyboard focus, naming what it restores
  (zoom, angle and centring) and its `0` shortcut, instead of relying on a
  slow native tooltip. Clicking it still only resets the view.
- Streamer mode uses the same hover and keyboard-focus explanation on the
  start page, in settings and in the match toolbar (#151).
- Settings explain themselves directly on hover or keyboard focus, without
  separate question-mark buttons. Each bot difficulty choice has its own
  explanation, including on the start page and in read-only game settings.
  How to play keeps its button with a book icon.

### Fixed

- A control that carries its own help text no longer pins that help open when
  it is clicked, and no longer reports `aria-expanded` as though it were a
  disclosure.
- Escape keeps a dismissed explanation hidden until the pointer moves away
  from its setting or keyboard focus moves, even when the popup covered
  another setting.
