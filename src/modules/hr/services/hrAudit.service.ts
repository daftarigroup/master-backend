import { prisma } from '../../../database/prisma';

export interface AuditLogOptions {
  entityType: 'candidate' | 'joining' | 'attendance' | 'leave' | 'gatepass' | 'advance' | 'employee' | 'salary' | 'social';
  entityId: string;
  eventType: string;
  performedBy?: string | null;
  notes?: string | null;
  metadata?: Record<string, any> | null;
}

export class HrAuditService {
  /**
   * Append an audit event to the append-only hr_audit_event log
   */
  static async log(options: AuditLogOptions, tx?: any): Promise<void> {
    try {
      const client = tx || prisma;
      await client.hrAuditEvent.create({
        data: {
          entity_type: options.entityType,
          entity_id: String(options.entityId),
          event_type: options.eventType,
          performed_by: options.performedBy || 'System',
          notes: options.notes || null,
          metadata: options.metadata || undefined,
        },
      });
    } catch (err) {
      console.error('[HrAuditService] Failed to record audit event:', err);
    }
  }

  /**
   * Query event chain for a specific entity
   */
  static async getEvents(entityType: string, entityId: string) {
    return prisma.hrAuditEvent.findMany({
      where: {
        entity_type: entityType,
        entity_id: String(entityId),
      },
      orderBy: { created_at: 'desc' },
    });
  }
}
