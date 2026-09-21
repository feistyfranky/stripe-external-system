import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { stripeService } from '../services/stripe';
import { usersRepo, productsRepo } from '../db/repositories';
import { config } from '../config';

export const checkoutRouter = Router();

const checkoutSchema = z.object({
  priceId: z.string().min(1, 'priceId is required'),
  userId: z.string().min(1, 'userId is required'),
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
});

checkoutRouter.post('/create-session', async (req: Request, res: Response): Promise<void> => {
  const parseResult = checkoutSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { priceId, userId, successUrl, cancelUrl } = parseResult.data;

  // Validate user exists
  const user = usersRepo.findById(userId);
  if (!user) {
    res.status(404).json({ error: `User with id ${userId} not found` });
    return;
  }

  // Validate product/price exists
  const product = productsRepo.findById(priceId);
  if (!product) {
    res.status(404).json({ error: `Product/Price ${priceId} not found` });
    return;
  }

  try {
    const session = await stripeService.createCheckoutSession({
      priceId,
      customerId: user.stripe_customer_id || undefined,
      customerEmail: user.email,
      userId: user.id,
      successUrl: successUrl || `${config.clientUrl}/?checkout_status=success`,
      cancelUrl: cancelUrl || `${config.clientUrl}/?checkout_status=cancel`,
    });

    res.json({
      sessionId: session.id,
      url: session.url,
      simulated: session.simulated,
      product: {
        id: product.id,
        name: product.name,
        amount: product.amount,
        currency: product.currency,
      },
    });
  } catch (err: any) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ error: err.message || 'Failed to create checkout session' });
  }
});
