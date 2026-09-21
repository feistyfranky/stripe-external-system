import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import Stripe from 'stripe';
import { stripeService } from '../services/stripe';
import { webhookProcessor } from '../services/webhook';
import { usersRepo, productsRepo } from '../db/repositories';

export const simulatorRouter = Router();

function buildMockEvent(type: string, data: any): Stripe.Event {
  const id = 'evt_sim_' + crypto.randomBytes(12).toString('hex');
  return {
    id,
    object: 'event',
    api_version: '2025-01-27.acacia',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: data,
    },
    livemode: false,
    pending_webhooks: 1,
    request: {
      id: 'req_sim_' + crypto.randomBytes(8).toString('hex'),
      idempotency_key: 'ik_sim_' + crypto.randomBytes(8).toString('hex'),
    },
    type: type as any,
  };
}

simulatorRouter.post('/trigger-event', async (req: Request, res: Response): Promise<void> => {
  const { eventType, userId, amount, currency } = req.body;

  const user = userId ? usersRepo.findById(userId) : usersRepo.list()[0];
  const customerId = user?.stripe_customer_id || 'cus_sim_' + crypto.randomBytes(6).toString('hex');
  const products = productsRepo.list();
  const product = products[0] || { id: 'price_mock', name: 'Starter Plan', amount: 1900 };
  const txAmount = amount ? parseInt(amount, 10) : product.amount;
  const curr = currency || 'usd';

  let eventPayload: Stripe.Event;

  switch (eventType) {
    case 'checkout.session.completed': {
      const sessionId = 'cs_sim_' + crypto.randomBytes(12).toString('hex');
      const subId = 'sub_sim_' + crypto.randomBytes(10).toString('hex');
      eventPayload = buildMockEvent('checkout.session.completed', {
        id: sessionId,
        object: 'checkout.session',
        client_reference_id: user?.id || 'usr_demo_001',
        customer: customerId,
        customer_email: user?.email || 'demo.developer@example.com',
        payment_status: 'paid',
        status: 'complete',
        mode: 'subscription',
        subscription: subId,
        metadata: {
          userId: user?.id || 'usr_demo_001',
          priceId: product.stripe_price_id || product.id,
        },
      });
      break;
    }

    case 'invoice.paid': {
      const invoiceId = 'in_sim_' + crypto.randomBytes(10).toString('hex');
      const paymentIntentId = 'pi_sim_' + crypto.randomBytes(10).toString('hex');
      eventPayload = buildMockEvent('invoice.paid', {
        id: invoiceId,
        object: 'invoice',
        amount_paid: txAmount,
        currency: curr,
        customer: customerId,
        customer_email: user?.email || 'demo.developer@example.com',
        number: 'INV-SIM-' + Math.floor(1000 + Math.random() * 9000),
        paid: true,
        status: 'paid',
        payment_intent: paymentIntentId,
        hosted_invoice_url: `https://pay.stripe.com/invoice/${invoiceId}/test`,
      });
      break;
    }

    case 'customer.subscription.updated': {
      const subId = 'sub_sim_' + crypto.randomBytes(10).toString('hex');
      const now = Math.floor(Date.now() / 1000);
      eventPayload = buildMockEvent('customer.subscription.updated', {
        id: subId,
        object: 'subscription',
        customer: customerId,
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: now,
        current_period_end: now + 30 * 24 * 3600,
        items: {
          data: [
            {
              id: 'si_sim_' + crypto.randomBytes(8).toString('hex'),
              price: {
                id: product.stripe_price_id || product.id,
                nickname: product.name,
                unit_amount: product.amount,
                currency: 'usd',
              },
            },
          ],
        },
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const subId = 'sub_sim_' + crypto.randomBytes(10).toString('hex');
      eventPayload = buildMockEvent('customer.subscription.deleted', {
        id: subId,
        object: 'subscription',
        customer: customerId,
        status: 'canceled',
        cancel_at_period_end: false,
      });
      break;
    }

    case 'payment_intent.succeeded': {
      const piId = 'pi_sim_' + crypto.randomBytes(10).toString('hex');
      eventPayload = buildMockEvent('payment_intent.succeeded', {
        id: piId,
        object: 'payment_intent',
        amount: txAmount,
        amount_received: txAmount,
        currency: curr,
        customer: customerId,
        status: 'succeeded',
        description: `One-time purchase / upgrade for ${user?.email || 'customer'}`,
        payment_method_types: ['card'],
        latest_charge: 'ch_sim_' + crypto.randomBytes(10).toString('hex'),
      });
      break;
    }

    case 'charge.refunded': {
      const chId = 'ch_sim_' + crypto.randomBytes(10).toString('hex');
      eventPayload = buildMockEvent('charge.refunded', {
        id: chId,
        object: 'charge',
        amount: txAmount,
        amount_refunded: txAmount,
        currency: curr,
        customer: customerId,
        refunded: true,
        refunds: {
          data: [
            {
              id: 're_sim_' + crypto.randomBytes(8).toString('hex'),
              amount: txAmount,
              currency: curr,
              reason: 'requested_by_customer',
            },
          ],
        },
      });
      break;
    }

    case 'payout.paid': {
      const poId = 'po_sim_' + crypto.randomBytes(10).toString('hex');
      eventPayload = buildMockEvent('payout.paid', {
        id: poId,
        object: 'payout',
        amount: txAmount * 5, // Payout typically batches several charges
        currency: curr,
        status: 'paid',
        destination: 'ba_sim_chase_operating',
      });
      break;
    }

    default:
      res.status(400).json({ error: `Unsupported simulated event type: ${eventType}` });
      return;
  }

  try {
    const result = await webhookProcessor.processEvent(eventPayload);
    res.json({
      simulated: true,
      result,
      event: eventPayload,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to process simulated event' });
  }
});
