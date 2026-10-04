<!-- bump: minor -->

### Changed

- New rooms use rules version 9: Audit moves the player clockwise to Tax and uses
  the normal property tax, with salary when passing Start. Saved rooms retain
  their original cards and rules; Chance entropy and deck handling are unchanged (#100).

### Fixed

- English and French Audit card text follows the room’s frozen movement rule,
  including property tax, salary and debt; saved rooms keep the cash-charge text (#117).
