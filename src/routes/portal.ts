import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { stripeService } from '../services/stripe';
import { usersRepo } from '../db/repositories';
import { config } from '../config';

export const portalRouter = Router();

const portalSchema = z.object({
  customerId: z.string().optional(),
  userId: z.string().optional(),
  returnUrl: z.string().optional(),
});

portalRouter.post('/create-session', async (req: Request, res: Response): Promise<void> => {
  const parseResult = portalSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  let customerId = parseResult.data.customerId;
  const { userId, returnUrl } = parseResult.data;

  if (!customerId && userId) {
    const user = usersRepo.findById(userId);
    if (!user || !user.stripe_customer_id) {
      res.status(404).json({ error: 'User does not have an associated Stripe customer ID' });
      return;
    }
    customerId = user.stripe_customer_id;
  }

  if (!customerId) {
    res.status(400).json({ error: 'Either customerId or valid userId with stripe_customer_id is required' });
    return;
  }

  try {
    const session = await stripeService.createPortalSession({
      customerId,
      returnUrl: returnUrl || config.clientUrl,
    });

    res.json({
      sessionId: session.id,
      url: session.url,
      simulated: session.simulated,
    });
  } catch (err: any) {
    console.error('Error creating portal session:', err);
    res.status(500).json({ error: err.message || 'Failed to create customer portal session' });
  }
});
