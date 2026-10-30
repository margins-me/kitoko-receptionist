import type { DepositRule, Rules } from "./schemas";

// Until a pro's payments are enabled (her payout account is set up), clients book without deposit or booking fee.
export function effectiveDepositRule(serviceDeposit: DepositRule | null, rules: Pick<Rules, "deposit">, paymentsEnabled: boolean): DepositRule {
  return paymentsEnabled ? (serviceDeposit ?? rules.deposit) : { mode: "none" };
}

// The rules a client sees and accepts: same as the pro's, minus the deposit while payments are off.
export function effectiveRules(rules: Rules, paymentsEnabled: boolean): Rules {
  return paymentsEnabled ? rules : { ...rules, deposit: { mode: "none" } };
}
