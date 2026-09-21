import { Router, Request, Response } from 'express';
import { stripeService } from '../services/stripe';
import { webhookProcessor } from '../services/webhook';

export const webhookRouter = Router();

// Notice: In index.ts, this route receives raw Buffer body
webhookRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['stripe-signature'] as string | undefined;

  let event;
  try {
    const rawBody = req.body;
    if (!rawBody || (Buffer.isBuffer(rawBody) && rawBody.length === 0)) {
      res.status(400).json({ error: 'Empty webhook payload body' });
      return;
    }

    event = stripeService.verifyAndConstructWebhookEvent(rawBody, signature);
  } catch (err: any) {
    console.warn(`[Webhook Verification Failed]: ${err.message}`);
    res.status(400).json({ error: `Webhook Error: ${err.message}` });
    return;
  }

  try {
    const result = await webhookProcessor.processEvent(event);
    res.status(200).json({
      received: true,
      eventId: result.eventId,
      eventType: result.eventType,
      isDuplicate: result.isDuplicate,
      message: result.message,
    });
  } catch (err: any) {
    console.error(`[Webhook Processing Error]:`, err);
    // Return 500 so Stripe knows to retry transient errors, or 200 if preferred
    res.status(500).json({ error: 'Internal server error while processing webhook' });
  }
});
