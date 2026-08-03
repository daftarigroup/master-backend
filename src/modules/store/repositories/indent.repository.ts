import { prisma } from '../../../database/prisma';
import { IndentRecordDTO } from '../types/indent.types';

export class IndentRepository {
  /**
   * Find all indents with optional firm filter
   */
  async findAll(permittedFirms?: string[]): Promise<any[]> {
    let whereClause: any = {};

    if (permittedFirms && permittedFirms.length > 0) {
      const ids = permittedFirms.filter((f) => /^\d+$/.test(f)).map(BigInt);
      const names = permittedFirms.filter((f) => !/^\d+$/.test(f));

      if (ids.length > 0) {
        whereClause.firm_id = { in: ids };
      } else if (names.length > 0) {
        whereClause.firm_name = { in: names };
      }
    }

    const records = await prisma.indent.findMany({
      where: whereClause,
      orderBy: {
        indent_number: 'desc',
      },
    });

    return records;
  }

  /**
   * Find indent by ID
   */
  async findById(id: number): Promise<any | null> {
    return prisma.indent.findUnique({
      where: { id: BigInt(id) },
    });
  }

  /**
   * Find indent by indent_number
   */
  async findByIndentNumber(indentNumber: string): Promise<any | null> {
    return prisma.indent.findFirst({
      where: { indent_number: indentNumber },
    });
  }

  /**
   * Update indent by ID
   */
  async updateById(id: number, data: any): Promise<any> {
    return prisma.indent.update({
      where: { id: BigInt(id) },
      data,
    });
  }

  /**
   * Update indent by indent_number
   */
  async updateByIndentNumber(indentNumber: string, data: any): Promise<any> {
    const record = await this.findByIndentNumber(indentNumber);
    if (!record) {
      throw new Error(`Indent with number ${indentNumber} not found`);
    }
    return prisma.indent.update({
      where: { id: record.id },
      data,
    });
  }
}
