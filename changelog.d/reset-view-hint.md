### Changed

- The reset view button on the board toolbar now explains itself with the
  shared help bubble on hover and on keyboard focus, naming what it restores
  (zoom, angle and centring) and its `0` shortcut, instead of relying on a
  slow native tooltip. Clicking it still only resets the view.

### Fixed

- A control that carries its own help text no longer pins that help open when
  it is clicked, and no longer reports `aria-expanded` as though it were a
  disclosure. Dedicated help buttons are unaffected.
