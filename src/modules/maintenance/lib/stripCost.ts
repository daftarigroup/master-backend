// Cost detail on a work order (estimates, actual parts and labour, part unit costs) is cost data: users without cost access never
// receive it. The older `cost` / bill amount fields on a work order predate this rule and are left as they were.
import { canViewCost } from '../../../middleware/requireCostAccess';
import { UserAuthContext } from '../../../utils/currentUser';

export function stripWorkOrderCost<T extends Record<string, any>>(dto: T): T {
  const copy: Record<string, any> = { ...dto };
  delete copy.costDetail;
  if (copy.parts && Array.isArray(copy.parts.lines)) {
    copy.parts = { ...copy.parts, lines: copy.parts.lines.map(({ issuedAmount: _a, ...rest }: Record<string, any>) => rest) };
  }
  if (Array.isArray(copy.repairParts)) copy.repairParts = copy.repairParts.map(({ unitCost: _u, ...rest }: Record<string, any>) => rest);
  return copy as T;
}

/** Applies the rule to one work order DTO or to a list envelope ({ data: [...] }). */
export async function shapeWorkOrders<T>(ctx: UserAuthContext, payload: T): Promise<T> {
  if (await canViewCost(ctx)) return payload;
  const p = payload as any;
  if (Array.isArray(p?.data)) return { ...p, data: p.data.map(stripWorkOrderCost) } as T;
  if (p && typeof p === 'object' && 'costDetail' in p) return stripWorkOrderCost(p) as T;
  return payload;
}
