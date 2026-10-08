<!-- bump: minor -->

### Added

- A forced sale no longer ends the moment the debt clears: in new rooms
  the seller keeps the sell decision and may sell as many properties
  as they like, finishing the phase themselves. The panel then reads "Sell
  more?", shows the cash raised so far and offers "Finish selling".

### Changed

- Saved matches keep their original forced sale, which closes as soon as the
  debt is covered.
- A timed-out human seat and every bot difficulty decline the optional part of a
  forced sale, so a sale that is already settled never liquidates more.
