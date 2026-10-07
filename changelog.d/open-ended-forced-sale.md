<!-- bump: minor -->

### Added

- A forced sale no longer ends the moment the debt clears: in new rooms (rules
  version 13) the seller keeps the sell decision and may sell as many properties
  as they like, finishing the phase themselves. The panel then reads "Sell
  more?", shows the cash raised so far and offers "Finish selling".

### Changed

- Rules version 13 freezes `sellBeyondDebt: true` for new rooms. Saved rooms
  through version 12 keep their original forced sale, which closes at zero cash.
- A timed-out human seat and every bot difficulty decline the optional part of a
  forced sale, so a sale that is already settled never liquidates more.
