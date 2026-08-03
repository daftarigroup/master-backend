import { Router, Request, Response } from 'express';
import { sendEmail } from '../utils/email';

const router = Router();

/**
 * POST /api/email/send
 * Express route to send emails via Resend API
 */
router.post('/send', async (req: Request, res: Response): Promise<void> => {
  try {
    const { to, subject, html, text, from, cc, bcc, attachments } = req.body;

    if (!to || !subject || (!html && !text)) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields. Please provide "to", "subject", and either "html" or "text".',
      });
      return;
    }

    const result = await sendEmail({
      to,
      subject,
      html,
      text,
      from,
      cc,
      bcc,
      attachments,
    });

    if (result.success) {
      res.status(200).json({
        success: true,
        data: result.data,
        message: 'Email sent successfully via Resend API.',
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || err,
    });
  }
});

export default router;
