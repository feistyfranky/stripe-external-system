import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { usersRepo, subscriptionsRepo, productsRepo, transactionsRepo } from '../db/repositories';
import { stripeService } from '../services/stripe';

export const customersRouter = Router();

// GET /api/users
customersRouter.get('/users', (req: Request, res: Response) => {
  const users = usersRepo.list();
  res.json({ users });
});

// POST /api/users
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  createStripeCustomer: z.boolean().optional(),
});

customersRouter.post('/users', async (req: Request, res: Response): Promise<void> => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, name, createStripeCustomer } = parsed.data;
  let stripeCustomerId: string | undefined;

  if (createStripeCustomer) {
    try {
      stripeCustomerId = await stripeService.createCustomer(email, name);
    } catch (err: any) {
      console.warn('Failed to auto-create Stripe customer:', err.message);
    }
  }

  try {
    const user = usersRepo.createUser(email, name, stripeCustomerId);
    res.status(201).json({ user });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to create user' });
  }
});

// GET /api/products
customersRouter.get('/products', (req: Request, res: Response) => {
  const products = productsRepo.list();
  res.json({ products });
});

// GET /api/subscriptions
customersRouter.get('/subscriptions', (req: Request, res: Response) => {
  const subscriptions = subscriptionsRepo.listRecent();
  res.json({ subscriptions });
});

// GET /api/transactions
customersRouter.get('/transactions', (req: Request, res: Response) => {
  const transactions = transactionsRepo.listRecent();
  res.json({ transactions });
});
