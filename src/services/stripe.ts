import Stripe from 'stripe';
import crypto from 'crypto';
import { config } from '../config';

// Initialize real Stripe SDK if key is valid
let realStripe: Stripe | null = null;
if (config.isStripeConfigured) {
  realStripe = new Stripe(config.stripeSecretKey, {
    apiVersion: '2025-01-27.acacia' as any,
    typescript: true,
  });
}

export interface CheckoutSessionParams {
  priceId: string;
  customerEmail?: string;
  customerId?: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PortalSessionParams {
  customerId: string;
  returnUrl: string;
}

export const stripeService = {
  isLiveConfigured(): boolean {
    return Boolean(realStripe);
  },

  getClient(): Stripe | null {
    return realStripe;
  },

  async createCustomer(email: string, name: string): Promise<string> {
    if (realStripe) {
      const customer = await realStripe.customers.create({
        email,
        name,
        metadata: {
          system: 'external_stripe_system',
        },
      });
      return customer.id;
    }

    // Mock customer ID
    return 'cus_sim_' + crypto.randomBytes(8).toString('hex');
  },

  async createCheckoutSession(params: CheckoutSessionParams): Promise<{ id: string; url: string; simulated: boolean }> {
    if (realStripe) {
      const session = await realStripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        customer: params.customerId,
        customer_email: params.customerId ? undefined : params.customerEmail,
        client_reference_id: params.userId,
        line_items: [
          {
            price: params.priceId,
            quantity: 1,
          },
        ],
        success_url: params.successUrl + '?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: params.cancelUrl,
        metadata: {
          userId: params.userId,
          priceId: params.priceId,
        },
      });

      return {
        id: session.id,
        url: session.url || params.successUrl,
        simulated: false,
      };
    }

    // Simulated Checkout session for immediate local demo/development
    const mockSessionId = 'cs_test_sim_' + crypto.randomBytes(12).toString('hex');
    const mockUrl = `${config.clientUrl}/?simulated_checkout=true&session_id=${mockSessionId}&user_id=${params.userId}&price_id=${params.priceId}`;

    return {
      id: mockSessionId,
      url: mockUrl,
      simulated: true,
    };
  },

  async createPortalSession(params: PortalSessionParams): Promise<{ id: string; url: string; simulated: boolean }> {
    if (realStripe) {
      const portalSession = await realStripe.billingPortal.sessions.create({
        customer: params.customerId,
        return_url: params.returnUrl,
      });

      return {
        id: portalSession.id,
        url: portalSession.url,
        simulated: false,
      };
    }

    // Simulated Billing Portal
    const mockSessionId = 'bps_sim_' + crypto.randomBytes(10).toString('hex');
    return {
      id: mockSessionId,
      url: `${config.clientUrl}/?simulated_portal=true&session_id=${mockSessionId}&customer_id=${params.customerId}`,
      simulated: true,
    };
  },

  verifyAndConstructWebhookEvent(rawBody: Buffer | string, signature: string | undefined): Stripe.Event {
    // If real Stripe is configured and signature is provided
    if (realStripe && config.stripeWebhookSecret && !config.stripeWebhookSecret.includes('placeholder')) {
      if (!signature) {
        throw new Error('Missing stripe-signature header');
      }
      return realStripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
    }

    // Simulator / Test Mode signature verification:
    // If webhook secret is set, verify standard HMAC-SHA256 signature scheme (t=...,v1=...)
    const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

    if (signature && signature.startsWith('t=')) {
      const parts = signature.split(',').reduce((acc, part) => {
        const [k, v] = part.split('=');
        if (k && v) acc[k.trim()] = v.trim();
        return acc;
      }, {} as Record<string, string>);

      const timestamp = parts['t'];
      const sig = parts['v1'];

      if (timestamp && sig && config.stripeWebhookSecret) {
        const signedPayload = `${timestamp}.${bodyStr}`;
        const expectedSig = crypto
          .createHmac('sha256', config.stripeWebhookSecret)
          .update(signedPayload, 'utf8')
          .digest('hex');

        const sigBuf = Buffer.from(sig, 'utf8');
        const expectedBuf = Buffer.from(expectedSig, 'utf8');

        if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
          return JSON.parse(bodyStr) as Stripe.Event;
        } else {
          // If in simulator mode and header was simulated without matching secret, allow simulator events
          if (config.simulatorEnabled && signature.includes('v1=simulated_sig')) {
            return JSON.parse(bodyStr) as Stripe.Event;
          }
          throw new Error('Signature verification failed: Invalid webhook signature');
        }
      }
    }

    // In simulator mode without strict secret, parse raw event
    if (config.simulatorEnabled) {
      try {
        return JSON.parse(bodyStr) as Stripe.Event;
      } catch (err: any) {
        throw new Error(`Invalid JSON payload: ${err.message}`);
      }
    }

    throw new Error('Webhook signature verification failed');
  },

  generateSimulatedSignature(rawBody: string, secret: string = config.stripeWebhookSecret): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signedPayload = `${timestamp}.${rawBody}`;
    const v1 = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
    return `t=${timestamp},v1=${v1}`;
  }
};
