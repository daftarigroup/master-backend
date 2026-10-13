import { z } from 'zod';
import { parseFirmId } from './firmScope';

// Small zod building blocks shared by validators that use validateParsed.
// Forms send '' for empty inputs, so blank/null is treated as "not given" (never as 0).

export const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const optNumber = z.preprocess(blankToUndefined, z.coerce.number().finite().optional());
export const reqNumber = z.coerce.number().finite();
export const optDate = z.preprocess(blankToUndefined, z.coerce.date().optional());
export const optText = z.preprocess(blankToUndefined, z.string().trim().max(500).optional());
export const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional());

/** A positive numeric id sent as a string or number, turned into a bigint. 'all' and junk are rejected. */
export const bigId = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const id = parseFirmId(v);
  if (id === null) ctx.addIssue({ code: 'custom', message: 'must be a valid id' });
  return id as bigint;
});
export const optBigId = z.preprocess(blankToUndefined, bigId.optional());
