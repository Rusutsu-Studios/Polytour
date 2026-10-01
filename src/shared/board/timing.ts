/** Rules and animation budgets, shared by the engine and presentation. */
export const DECISION_TIMING = {
  roll: 10_000,
  choice: 15_000,
  sell: 30_000,
  diceAnimation: 1_000,
  stepAnimation: 190,
  cardAnimation: 600,
  moneyAnimation: 200,
  propertyAnimation: 450,
} as const;

export const CHANCE_AMOUNTS = {
  windfall: 150_000,
  fine: 100_000,
  birthday: 50_000,
  auditPercent: 10,
  charity: 100_000,
  detourSteps: 3,
  countryMultiplier: 2,
  initialHostMultiplier: 2,
  maxHostMultiplier: 5,
} as const;
