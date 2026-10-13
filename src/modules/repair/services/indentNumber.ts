import { Prisma } from '@prisma/client';
import { documentSequenceService } from '../../../services/documentSequence.service';

type Tx = Prisma.TransactionClient;

// Indent numbers (REP-YYYY-NNN) were generated from two different counters: the repair module used the global one
// while the maintenance out-source path used a per-firm one, and both write the same unique `indentNumber` column,
// so two firms (or one firm and the global counter) could mint the same number and the second insert failed.
// There is now one path: the global counter, with a defensive check in case a number already exists from the old
// per-firm days.
export async function nextIndentNumber(tx: Tx): Promise<string> {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = await documentSequenceService.next({ prefix: 'REP', year, pad: 3 }, tx);
    const taken = await tx.repairIndent.findUnique({ where: { indentNumber: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  throw new Error('Could not allocate a free repair indent number');
}
