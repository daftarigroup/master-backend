export interface StructurePercents {
  basicPercent: number;
  hraPercent: number;
  conveyancePercent: number;
  medicalPercent: number;
  specialAllowancePercent: number;
}

export interface DeductionDef {
  id: string;
  name: string;
  percent: number;
  employerPercent?: number;
  basis: 'basic' | 'gross';
  active: boolean;
  grossLimit?: number;
}

export interface DeductionLine {
  id: string;
  name: string;
  percent: number;
  basis: string;
  amount: number;
}

export interface StructureBreakdown {
  basic: number;
  hra: number;
  conveyance: number;
  medicalAllowance: number;
  specialAllowance: number;
  grossEarnings: number;
  deductionBreakdown: DeductionLine[];
  totalDeductions: number;
  netPay: number;
}

export interface PayPolicyRates {
  otEnabled: boolean;
  standardShiftHours: number;
  overtimeRateMultiplier: number;
  pfEnabled: boolean;
  pfEmployeeRate: number;
  pfEmployerRate: number;
  esiEnabled: boolean;
  esiEmployeeRate: number;
  esiEmployerRate: number;
  esiGrossLimit: number;
}

export interface PayslipInput {
  monthlySalary: number;
  pfEligible: boolean;
  esicEligible: boolean;
  daysInMonth: number;
  presentDays: number;
  leaveDays: number;
  halfDays: number;
  overtimeHours: number;
  structure: StructurePercents;
  deductions: DeductionDef[];
  policy: PayPolicyRates;
  loanEmi: number;
  loanOutstanding: number;
}

export interface PayslipResult {
  daysInMonth: number;
  effectivePaidDays: number;
  monthlyCtc: number;
  calculationDays: number;
  basic: number;
  hra: number;
  conveyance: number;
  medicalAllowance: number;
  specialAllowance: number;
  overtimePay: number;
  grossEarnings: number;
  empPF: number;
  erPF: number;
  empESIC: number;
  erESIC: number;
  loanDeduction: number;
  deductionBreakdown: DeductionLine[];
  totalDeductions: number;
  netPay: number;
  overtimeHours: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const PF_ESIC_SEED_IDS = new Set(['emp_pf', 'emp_esic']);

/**
 * Splits a monthly amount into Basic/HRA/Conveyance/Medical/Special using the
 * saved structure %, then runs the structure's own custom deduction rows
 * against it. Used both for the "₹50k CTC" structure-editor preview and as
 * the base split inside computePayslip (before attendance proration).
 */
export function computeStructureBreakdown(
  monthlyAmount: number,
  structure: StructurePercents,
  deductions: DeductionDef[]
): StructureBreakdown {
  const basic = round2(monthlyAmount * (structure.basicPercent / 100));
  const hra = round2(monthlyAmount * (structure.hraPercent / 100));
  const conveyance = round2(monthlyAmount * (structure.conveyancePercent / 100));
  const medicalAllowance = round2(monthlyAmount * (structure.medicalPercent / 100));
  const specialAllowance = round2(monthlyAmount * (Math.max(0, structure.specialAllowancePercent) / 100));
  const grossEarnings = round2(basic + hra + conveyance + medicalAllowance + specialAllowance);

  const deductionBreakdown: DeductionLine[] = [];
  let totalDeductions = 0;
  for (const d of deductions) {
    if (!d.active) continue;
    if (d.grossLimit !== undefined && grossEarnings > d.grossLimit) continue;
    const base = d.basis === 'basic' ? basic : grossEarnings;
    const amount = round2(base * (d.percent / 100));
    totalDeductions = round2(totalDeductions + amount);
    deductionBreakdown.push({ id: d.id, name: d.name, percent: d.percent, basis: d.basis, amount });
  }

  const netPay = round2(grossEarnings - totalDeductions);

  return { basic, hra, conveyance, medicalAllowance, specialAllowance, grossEarnings, deductionBreakdown, totalDeductions, netPay };
}

/**
 * Full monthly payslip calculation: prorates the structure split by
 * attendance, applies OT/PF/ESIC from the pay policy, and layers on the
 * structure's custom deductions + active loan EMI.
 */
export function computePayslip(input: PayslipInput): PayslipResult {
  const { daysInMonth, presentDays, leaveDays, halfDays, overtimeHours, policy } = input;
  const effectivePaidDays = presentDays + leaveDays + halfDays * 0.5;
  const attendanceRatio = daysInMonth > 0 ? effectivePaidDays / daysInMonth : 0;

  const monthlyCtc = input.monthlySalary;
  const full = computeStructureBreakdown(monthlyCtc, input.structure, input.deductions);

  const basic = round2(full.basic * attendanceRatio);
  const hra = round2(full.hra * attendanceRatio);
  const conveyance = round2(full.conveyance * attendanceRatio);
  const medicalAllowance = round2(full.medicalAllowance * attendanceRatio);
  const specialAllowance = round2(full.specialAllowance * attendanceRatio);
  const earnedGross = round2(basic + hra + conveyance + medicalAllowance + specialAllowance);

  let overtimePay = 0;
  if (policy.otEnabled && policy.standardShiftHours > 0) {
    const dailyRate = daysInMonth > 0 ? basic / daysInMonth : 0;
    const hourlyRate = dailyRate / policy.standardShiftHours;
    overtimePay = round2(hourlyRate * overtimeHours * policy.overtimeRateMultiplier);
  }

  const grossEarnings = round2(earnedGross + overtimePay);

  const empPF = policy.pfEnabled && input.pfEligible ? round2(basic * (policy.pfEmployeeRate / 100)) : 0;
  const erPF = policy.pfEnabled && input.pfEligible ? round2(basic * (policy.pfEmployerRate / 100)) : 0;
  const esicApplies = policy.esiEnabled && input.esicEligible && grossEarnings <= policy.esiGrossLimit;
  const empESIC = esicApplies ? round2(grossEarnings * (policy.esiEmployeeRate / 100)) : 0;
  const erESIC = esicApplies ? round2(grossEarnings * (policy.esiEmployerRate / 100)) : 0;

  const loanDeduction = Math.max(0, Math.min(input.loanEmi, input.loanOutstanding));

  const deductionBreakdown: DeductionLine[] = [];
  if (empPF > 0) deductionBreakdown.push({ id: 'pf', name: 'Provident Fund (PF)', percent: policy.pfEmployeeRate, basis: 'basic', amount: empPF });
  if (empESIC > 0) deductionBreakdown.push({ id: 'esic', name: 'ESIC', percent: policy.esiEmployeeRate, basis: 'gross', amount: empESIC });

  for (const d of input.deductions) {
    if (!d.active || PF_ESIC_SEED_IDS.has(d.id)) continue;
    if (d.grossLimit !== undefined && grossEarnings > d.grossLimit) continue;
    const base = d.basis === 'basic' ? basic : grossEarnings;
    const amount = round2(base * (d.percent / 100));
    if (amount <= 0) continue;
    deductionBreakdown.push({ id: d.id, name: d.name, percent: d.percent, basis: d.basis, amount });
  }

  if (loanDeduction > 0) {
    deductionBreakdown.push({ id: 'loan_active', name: 'Loan EMI', percent: 0, basis: 'flat', amount: loanDeduction });
  }

  const totalDeductions = round2(deductionBreakdown.reduce((s, d) => s + d.amount, 0));
  const netPay = Math.max(0, round2(grossEarnings - totalDeductions));

  return {
    daysInMonth,
    effectivePaidDays,
    monthlyCtc,
    calculationDays: effectivePaidDays,
    basic,
    hra,
    conveyance,
    medicalAllowance,
    specialAllowance,
    overtimePay,
    grossEarnings,
    empPF,
    erPF,
    empESIC,
    erESIC,
    loanDeduction,
    deductionBreakdown,
    totalDeductions,
    netPay,
    overtimeHours,
  };
}
