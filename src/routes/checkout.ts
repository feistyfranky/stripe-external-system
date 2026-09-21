import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { stripeService } from '../services/stripe';
import { usersRepo, productsRepo } from '../db/repositories';
import { config } from '../config';

export const checkoutRouter = Router();

const checkoutSchema = z.object({
  priceId: z.string().optional(),
  userId: z.string().optional(),
  amount: z.number().positive().optional(),
  currency: z.string().optional().default('usd'),
  productName: z.string().optional(),
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
});

checkoutRouter.post('/create-session', async (req: Request, res: Response): Promise<void> => {
  const parseResult = checkoutSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: parseResult.error.flatten() });
    return;
  }

  const { priceId, userId, amount, currency, productName, successUrl, cancelUrl } = parseResult.data;

  // Resolve user
  const user = userId ? usersRepo.findById(userId) : usersRepo.list()[0];

  // Resolve product/price if priceId is provided
  let product = priceId ? productsRepo.findById(priceId) : undefined;
  const chargeAmount = amount || product?.amount || 4900;
  const chargeCurrency = currency || product?.currency || 'usd';
  const name = productName || product?.name || `Payment ($${(chargeAmount / 100).toFixed(2)})`;

  try {
    const session = await stripeService.createCheckoutSession({
      priceId,
      customerId: user?.stripe_customer_id || undefined,
      customerEmail: user?.email,
      userId: user?.id || 'usr_default',
      amount: chargeAmount,
      currency: chargeCurrency,
      productName: name,
      successUrl: successUrl || `${config.clientUrl}/?checkout_status=success`,
      cancelUrl: cancelUrl || `${config.clientUrl}/?checkout_status=cancel`,
    });

    res.json({
      sessionId: session.id,
      url: session.url,
      simulated: session.simulated,
      product: {
        id: product?.id || 'custom_payment',
        name,
        amount: chargeAmount,
        currency: chargeCurrency,
      },
    });
  } catch (err: any) {
    console.error('Error creating checkout session:', err);
    res.status(500).json({ error: err.message || 'Failed to create checkout session' });
  }
});
