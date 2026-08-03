import { Resend } from 'resend';
import { config } from '../config/index';

const resendApiKey = config.resend.apiKey;

export const resend = resendApiKey ? new Resend(resendApiKey) : null;

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: Array<{
    filename: string;
    content?: string | Buffer;
    path?: string;
  }>;
}

/**
 * Utility service to send email using Resend API.
 */
export async function sendEmail(options: SendEmailOptions): Promise<{ success: boolean; data?: any; error?: any }> {
  try {
    const apiKey = config.resend.apiKey;
    if (!apiKey) {
      console.warn('[Resend Email Service] RESEND_API_KEY is not defined in backend environment variables.');
      return {
        success: false,
        error: 'RESEND_API_KEY is missing in backend environment variables.',
      };
    }

    const client = resend || new Resend(apiKey);
    const fromAddress = options.from || config.resend.fromEmail;

    const payload: any = {
      from: fromAddress,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
    };

    if (options.html) payload.html = options.html;
    if (options.text) payload.text = options.text;
    if (options.cc) payload.cc = Array.isArray(options.cc) ? options.cc : [options.cc];
    if (options.bcc) payload.bcc = Array.isArray(options.bcc) ? options.bcc : [options.bcc];
    if (options.attachments) payload.attachments = options.attachments;

    const { data, error } = await client.emails.send(payload);

    if (error) {
      console.error('[Resend Email Service Error]:', error);
      return { success: false, error };
    }

    console.log('[Resend Email Service Success]: Sent email to', payload.to, 'Message ID:', data?.id);
    return { success: true, data };
  } catch (err: any) {
    console.error('[Resend Email Service Exception]:', err?.message || err);
    return { success: false, error: err?.message || err };
  }
}
