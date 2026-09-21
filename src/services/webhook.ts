import Stripe from 'stripe';
import { eventsRepo, usersRepo, subscriptionsRepo, productsRepo } from '../db/repositories';
import { ledgerService } from './ledger';

export interface WebhookProcessResult {
  success: boolean;
  eventId: string;
  eventType: string;
  isDuplicate: boolean;
  message?: string;
}

export const webhookProcessor = {
  async processEvent(event: Stripe.Event): Promise<WebhookProcessResult> {
    const eventId = event.id;
    const eventType = event.type;

    // 1. Idempotency check: record the event in database
    const recordResult = eventsRepo.recordReceived({
      id: eventId,
      type: eventType,
      livemode: event.livemode,
      api_version: event.api_version || undefined,
      payload: event,
    });

    if (recordResult.isDuplicate && recordResult.status === 'processed') {
      return {
        success: true,
        eventId,
        eventType,
        isDuplicate: true,
        message: 'Event was already processed (idempotent skip)',
      };
    }

    try {
      // 2. Dispatch to specific business logic handlers
      await this.routeEvent(event);

      // 3. Mark processed
      eventsRepo.markProcessed(eventId);

      return {
        success: true,
        eventId,
        eventType,
        isDuplicate: false,
        message: 'Event processed successfully',
      };
    } catch (err: any) {
      console.error(`[Webhook Error] Failed processing event ${eventId} (${eventType}):`, err);
      eventsRepo.markFailed(eventId, err.message || 'Unknown processing error');
      throw err;
    }
  },

  async routeEvent(event: Stripe.Event): Promise<void> {
    const dataObj = event.data.object as any;

    switch (event.type) {
      case 'checkout.session.completed': {
        await this.handleCheckoutSessionCompleted(dataObj);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await this.handleSubscriptionUpdated(dataObj);
        break;
      }

      case 'customer.subscription.deleted': {
        await this.handleSubscriptionDeleted(dataObj);
        break;
      }

      case 'invoice.paid': {
        await this.handleInvoicePaid(dataObj);
        break;
      }

      case 'payment_intent.succeeded': {
        await this.handlePaymentIntentSucceeded(dataObj);
        break;
      }

      case 'charge.refunded': {
        await this.handleChargeRefunded(dataObj);
        break;
      }

      case 'payout.paid': {
        await this.handlePayoutPaid(dataObj);
        break;
      }

      default:
        // Other events can be stored for audit without specific actions
        break;
    }
  },

  async handleCheckoutSessionCompleted(session: any) {
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const userId = session.client_reference_id || session.metadata?.userId;

    if (userId && customerId) {
      // Associate internal user with Stripe Customer ID
      usersRepo.createOrUpdateStripeCustomer(userId, customerId);
    }

    // If this session is for a subscription, record or verify subscription state
    if (session.subscription) {
      const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
      const priceId = session.metadata?.priceId || 'price_starter';
      const product = productsRepo.findById(priceId);

      subscriptionsRepo.upsert({
        stripeSubscriptionId: subId,
        stripeCustomerId: customerId,
        userId: userId || null,
        planId: priceId,
        planName: product ? product.name : 'Subscription Plan',
        status: 'active',
      });
    }
  },

  async handleSubscriptionUpdated(subscription: any) {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    const subId = subscription.id;
    const status = subscription.status;
    const priceId = subscription.items?.data?.[0]?.price?.id || 'price_default';
    const product = productsRepo.findById(priceId);

    // Map customer to internal user
    const user = customerId ? usersRepo.findByStripeCustomerId(customerId) : null;

    const currentPeriodStart = subscription.current_period_start
      ? new Date(subscription.current_period_start * 1000).toISOString()
      : null;
    const currentPeriodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;

    subscriptionsRepo.upsert({
      stripeSubscriptionId: subId,
      stripeCustomerId: customerId,
      userId: user?.id || null,
      planId: priceId,
      planName: product ? product.name : 'Active Plan',
      status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });
  },

  async handleSubscriptionDeleted(subscription: any) {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    const subId = subscription.id;
    const user = customerId ? usersRepo.findByStripeCustomerId(customerId) : null;

    subscriptionsRepo.upsert({
      stripeSubscriptionId: subId,
      stripeCustomerId: customerId,
      userId: user?.id || null,
      planId: subscription.items?.data?.[0]?.price?.id || 'canceled',
      planName: 'Canceled Plan',
      status: 'canceled',
      cancelAtPeriodEnd: false,
    });
  },

  async handleInvoicePaid(invoice: any) {
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
    const user = customerId ? usersRepo.findByStripeCustomerId(customerId) : null;
    const amount = invoice.amount_paid || 0;
    const currency = invoice.currency || 'usd';
    const paymentIntentId = typeof invoice.payment_intent === 'string' 
      ? invoice.payment_intent 
      : invoice.payment_intent?.id || `pi_inv_${invoice.id}`;

    if (amount > 0) {
      ledgerService.recordSuccessfulPayment({
        userId: user?.id || null,
        paymentIntentId,
        chargeId: invoice.charge ? (typeof invoice.charge === 'string' ? invoice.charge : invoice.charge.id) : undefined,
        invoiceId: invoice.id,
        amount,
        currency,
        description: `Invoice ${invoice.number || invoice.id} payment`,
        receiptUrl: invoice.hosted_invoice_url,
      });
    }
  },

  async handlePaymentIntentSucceeded(paymentIntent: any) {
    const customerId = typeof paymentIntent.customer === 'string' ? paymentIntent.customer : paymentIntent.customer?.id;
    const user = customerId ? usersRepo.findByStripeCustomerId(customerId) : null;
    const amount = paymentIntent.amount_received || paymentIntent.amount || 0;
    const currency = paymentIntent.currency || 'usd';

    // Avoid duplicate ledger entry if already handled via invoice.paid
    if (paymentIntent.invoice) {
      return;
    }

    ledgerService.recordSuccessfulPayment({
      userId: user?.id || null,
      paymentIntentId: paymentIntent.id,
      chargeId: paymentIntent.latest_charge,
      amount,
      currency,
      description: paymentIntent.description || `PaymentIntent ${paymentIntent.id}`,
      paymentMethod: paymentIntent.payment_method_types?.[0] || 'card',
    });
  },

  async handleChargeRefunded(charge: any) {
    const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;
    const user = customerId ? usersRepo.findByStripeCustomerId(customerId) : null;
    const amountRefunded = charge.amount_refunded || 0;
    const currency = charge.currency || 'usd';

    ledgerService.recordRefund({
      userId: user?.id || null,
      chargeId: charge.id,
      amount: amountRefunded,
      currency,
      reason: charge.refunds?.data?.[0]?.reason || 'Customer refund requested',
    });
  },

  async handlePayoutPaid(payout: any) {
    const amount = payout.amount || 0;
    const currency = payout.currency || 'usd';

    ledgerService.recordPayout({
      payoutId: payout.id,
      amount,
      currency,
      bankName: payout.destination ? `Destination: ${payout.destination}` : 'Primary Bank Account',
    });
  },
};
