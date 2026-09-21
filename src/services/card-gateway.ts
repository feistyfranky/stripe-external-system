import crypto from 'crypto';
import { stripeService } from './stripe';
import { ledgerService } from './ledger';
import { webhookProcessor } from './webhook';
import { usersRepo, paymentMethodsRepo } from '../db/repositories';
import { config } from '../config';

export function validateLuhn(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function detectCardBrand(cardNumber: string): string {
  const clean = cardNumber.replace(/\D/g, '');
  if (/^4/.test(clean)) return 'visa';
  if (/^(5[1-5]|222[1-9]|22[3-9][0-9]|2[3-6][0-9]{2}|27[01][0-9]|2720)/.test(clean)) return 'mastercard';
  if (/^3[47]/.test(clean)) return 'amex';
  if (/^6(?:011|5[0-9]{2})/.test(clean)) return 'discover';
  if (/^3(?:0[0-5]|[68][0-9])/.test(clean)) return 'diners';
  if (/^(?:2131|1800|35\d{3})/.test(clean)) return 'jcb';
  return 'card';
}

export interface ProcessCardParams {
  cardNumber: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  cardholderName?: string;
  billingZip?: string;
  amount: number; // in cents
  currency?: string;
  userId?: string;
  description?: string;
  saveCard?: boolean;
}

export interface CardProcessResult {
  success: boolean;
  status: 'succeeded' | 'failed' | 'requires_action';
  paymentIntentId: string;
  chargeId: string;
  amount: number;
  currency: string;
  brand: string;
  last4: string;
  paymentMethodId: string;
  receiptUrl: string;
  ledgerTransactionId?: string;
  errorMessage?: string;
  declineCode?: string;
}

export const cardGateway = {
  validateCardDetails(params: ProcessCardParams): { valid: boolean; error?: string } {
    const cleanNumber = params.cardNumber.replace(/\s+/g, '');
    
    // Check digits
    if (!/^\d{13,19}$/.test(cleanNumber)) {
      return { valid: false, error: 'Your card number is invalid (must be between 13 and 19 digits).' };
    }

    // Check Luhn algorithm
    if (!validateLuhn(cleanNumber)) {
      return { valid: false, error: 'Your card number failed the checksum verification (invalid card number).' };
    }

    // Check Expiration
    if (params.expMonth < 1 || params.expMonth > 12) {
      return { valid: false, error: 'Your card expiration month is invalid (must be 01 to 12).' };
    }

    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    let fullYear = params.expYear;
    if (fullYear < 100) fullYear += 2000;

    if (fullYear < currentYear || (fullYear === currentYear && params.expMonth < currentMonth)) {
      return { valid: false, error: 'Your card has expired.' };
    }

    // Check CVC
    const cleanCvc = params.cvc.trim();
    if (!/^\d{3,4}$/.test(cleanCvc)) {
      return { valid: false, error: 'Your card security code (CVC) is incomplete or invalid.' };
    }

    return { valid: true };
  },

  async processCard(params: ProcessCardParams): Promise<CardProcessResult> {
    const validation = this.validateCardDetails(params);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const cleanNumber = params.cardNumber.replace(/\s+/g, '');
    const brand = detectCardBrand(cleanNumber);
    const last4 = cleanNumber.slice(-4);
    const currency = (params.currency || 'usd').toLowerCase();
    const amount = params.amount;

    // Simulate known Stripe decline test cards:
    // 4000 0000 0000 0002 -> Insufficient funds
    // 4000 0000 0000 0005 -> Do not honor
    if (cleanNumber.endsWith('0002')) {
      const err = new Error('Your card has insufficient funds.');
      (err as any).declineCode = 'insufficient_funds';
      throw err;
    }
    if (cleanNumber.endsWith('0005')) {
      const err = new Error('Your card was declined by your bank.');
      (err as any).declineCode = 'do_not_honor';
      throw err;
    }

    // Resolve or find User
    const user = params.userId ? usersRepo.findById(params.userId) : usersRepo.list()[0];
    const customerId = user?.stripe_customer_id || 'cus_' + crypto.randomBytes(8).toString('hex');

    // 1. If real Stripe is configured (sk_live_... or sk_test_...), execute LIVE card charge!
    const stripeClient = stripeService.getClient();
    if (stripeClient) {
      try {
        // Create actual PaymentMethod on Stripe network
        const pm = await stripeClient.paymentMethods.create({
          type: 'card',
          card: {
            number: cleanNumber,
            exp_month: params.expMonth,
            exp_year: params.expYear,
            cvc: params.cvc,
          },
          billing_details: {
            name: params.cardholderName,
            address: params.billingZip ? { postal_code: params.billingZip } : undefined,
          },
        });

        // Create & Confirm actual PaymentIntent on Stripe network (charges real card)
        const pi = await stripeClient.paymentIntents.create({
          amount,
          currency,
          payment_method: pm.id,
          confirm: true,
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
          description: params.description || `Card payment for ${params.cardholderName || 'Customer'}`,
        });

        const latestCharge = pi.latest_charge as any;
        const chargeId = typeof latestCharge === 'string' ? latestCharge : latestCharge?.id || ('ch_' + pi.id);
        const receiptUrl = typeof latestCharge === 'object' && latestCharge?.receipt_url ? latestCharge.receipt_url : `${config.clientUrl}/receipts/REC-${pi.id.slice(-6)}`;

        // Store masked payment method in local database
        paymentMethodsRepo.create({
          userId: user?.id || null,
          paymentMethodId: pm.id,
          brand: pm.card?.brand || brand,
          last4: pm.card?.last4 || last4,
          expMonth: pm.card?.exp_month || params.expMonth,
          expYear: pm.card?.exp_year || params.expYear,
          cardholderName: params.cardholderName || user?.name || 'Cardholder',
          isDefault: true,
        });

        // Record in transactions and double-entry ledger
        const tx = ledgerService.recordSuccessfulPayment({
          userId: user?.id || null,
          paymentIntentId: pi.id,
          chargeId,
          amount,
          currency,
          description: params.description || `Live Stripe Card (${brand.toUpperCase()} ****${last4})`,
          paymentMethod: brand,
          receiptUrl,
        });

        return {
          success: true,
          status: 'succeeded',
          paymentIntentId: pi.id,
          chargeId,
          amount,
          currency,
          brand: pm.card?.brand || brand,
          last4: pm.card?.last4 || last4,
          paymentMethodId: pm.id,
          receiptUrl,
          ledgerTransactionId: tx.id,
        };
      } catch (stripeErr: any) {
        console.error('Stripe Live API Error:', stripeErr);
        const err = new Error(stripeErr.message || 'Stripe declined the card.');
        (err as any).declineCode = stripeErr.code || stripeErr.decline_code || 'card_declined';
        throw err;
      }
    }

    // 2. Standalone / Simulator Mode (used when no real Stripe keys are in .env)
    const paymentMethodId = 'pm_' + crypto.randomBytes(12).toString('hex');
    const paymentIntentId = 'pi_' + crypto.randomBytes(12).toString('hex');
    const chargeId = 'ch_' + crypto.randomBytes(12).toString('hex');
    const receiptNumber = 'REC-' + Math.floor(100000 + Math.random() * 900000);
    const receiptUrl = `${config.clientUrl}/receipts/${receiptNumber}`;

    // Store masked payment method in database
    paymentMethodsRepo.create({
      userId: user?.id || null,
      paymentMethodId,
      brand,
      last4,
      expMonth: params.expMonth,
      expYear: params.expYear,
      cardholderName: params.cardholderName || user?.name || 'Cardholder',
      isDefault: true,
    });

    // Post to double-entry ledger & record transaction
    const tx = ledgerService.recordSuccessfulPayment({
      userId: user?.id || null,
      paymentIntentId,
      chargeId,
      amount,
      currency,
      description: params.description || `Card payment (${brand.toUpperCase()} ****${last4})`,
      paymentMethod: brand,
      receiptUrl,
    });

    // Construct and dispatch internal Stripe webhook event: payment_intent.succeeded
    const webhookEvent = {
      id: 'evt_' + crypto.randomBytes(12).toString('hex'),
      object: 'event' as const,
      api_version: '2025-01-27.acacia',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: paymentIntentId,
          object: 'payment_intent',
          amount,
          amount_received: amount,
          currency,
          customer: customerId,
          status: 'succeeded',
          description: params.description || `Card payment (${brand.toUpperCase()} ****${last4})`,
          payment_method: paymentMethodId,
          payment_method_types: ['card'],
          latest_charge: chargeId,
        } as any,
      },
      livemode: config.isStripeConfigured,
      pending_webhooks: 1,
      request: {
        id: 'req_' + crypto.randomBytes(8).toString('hex'),
        idempotency_key: 'ik_' + crypto.randomBytes(8).toString('hex'),
      },
      type: 'payment_intent.succeeded' as const,
    };

    // Ingest into webhook pipeline (deduplication & event store)
    try {
      await webhookProcessor.processEvent(webhookEvent);
    } catch (whErr) {
      console.warn('Webhook ingestion warning for card payment:', whErr);
    }

    return {
      success: true,
      status: 'succeeded',
      paymentIntentId,
      chargeId,
      amount,
      currency,
      brand,
      last4,
      paymentMethodId,
      receiptUrl,
      ledgerTransactionId: tx.id,
    };
  },
};
