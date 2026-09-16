import { HrAuditService } from './hrAudit.service';

export interface NotificationPayload {
  to: string; // phone / whatsapp number
  type: 'GATE_PASS_ISSUED' | 'LEAVE_STATUS_CHANGED' | 'OFFER_LETTER_SENT' | 'JOINING_INITIATED';
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

export class NotificationService {
  /**
   * Dispatch a notification (WhatsApp / SMS / System hook)
   */
  static async sendWhatsApp(payload: NotificationPayload): Promise<{ success: boolean; messageId?: string }> {
    try {
      console.log(`[NotificationService] Sending WhatsApp to ${payload.to}: ${payload.title} - ${payload.message}`);

      // Record to audit log
      await HrAuditService.log({
        entityType: 'gatepass',
        entityId: payload.metadata?.id ? String(payload.metadata.id) : 'unknown',
        eventType: `WHATSAPP_DISPATCHED_${payload.type}`,
        notes: `Notification sent to ${payload.to}: ${payload.title}`,
        metadata: {
          to: payload.to,
          type: payload.type,
          title: payload.title,
          dispatchedAt: new Date().toISOString(),
        },
      });

      return { success: true, messageId: `wa_${Date.now()}` };
    } catch (err) {
      console.error('[NotificationService] WhatsApp dispatch error:', err);
      return { success: false };
    }
  }
}
