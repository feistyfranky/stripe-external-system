import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { cardGateway, detectCardBrand } from '../services/card-gateway';
import { paymentMethodsRepo, usersRepo } from '../db/repositories';

export const paymentsRouter = Router();

const processCardSchema = z.object({
  cardNumber: z.string().min(13, 'Card number must be at least 13 digits'),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2024),
  cvc: z.string().min(3).max(4),
  cardholderName: z.string().optional(),
  billingZip: z.string().optional(),
  amount: z.number().int().positive('Amount in cents must be greater than zero'),
  currency: z.string().optional().default('usd'),
  userId: z.string().optional(),
  description: z.string().optional(),
  saveCard: z.boolean().optional(),
});

// POST /api/payments/process-card
paymentsRouter.post('/process-card', async (req: Request, res: Response): Promise<void> => {
  const parseResult = processCardSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: {
        type: 'validation_error',
        message: parseResult.error.issues?.[0]?.message || 'Invalid card payment details',
        fields: parseResult.error.flatten(),
      },
    });
    return;
  }

  try {
    const result = await cardGateway.processCard(parseResult.data);
    res.json(result);
  } catch (err: any) {
    res.status(402).json({
      error: {
        type: 'card_error',
        message: err.message || 'Payment processing failed',
        declineCode: err.declineCode || 'card_declined',
      },
    });
  }
});

// GET /api/payments/methods
paymentsRouter.get('/methods', (req: Request, res: Response) => {
  const userId = req.query.userId as string | undefined;
  if (userId) {
    const methods = paymentMethodsRepo.findByUserId(userId);
    res.json({ paymentMethods: methods });
  } else {
    const methods = paymentMethodsRepo.list();
    res.json({ paymentMethods: methods });
  }
});

// GET /api/payments/test-cards
paymentsRouter.get('/test-cards', (req: Request, res: Response) => {
  res.json({
    testCards: [
      {
        name: 'Visa (Success)',
        number: '4242 4242 4242 4242',
        brand: 'visa',
        exp: '12/28',
        cvc: '123',
        description: 'Standard successful payment card',
      },
      {
        name: 'Mastercard (Success)',
        number: '5555 5555 5555 4444',
        brand: 'mastercard',
        exp: '11/29',
        cvc: '456',
        description: 'Standard successful Mastercard',
      },
      {
        name: 'American Express (Success)',
        number: '3782 822463 10005',
        brand: 'amex',
        exp: '10/27',
        cvc: '1234',
        description: '4-digit CVC American Express',
      },
      {
        name: 'Insufficient Funds (Decline)',
        number: '4000 0000 0000 0002',
        brand: 'visa',
        exp: '08/28',
        cvc: '999',
        description: 'Simulates card declined due to insufficient balance',
      },
    ],
  });
});
