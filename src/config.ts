import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  clientUrl: string;
  databasePath: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  simulatorEnabled: boolean;
  isStripeConfigured: boolean;
}

const isStripeConfigured = 
  Boolean(process.env.STRIPE_SECRET_KEY) && 
  !process.env.STRIPE_SECRET_KEY?.includes('placeholder') &&
  (process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') || process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_'));

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  databasePath: process.env.DATABASE_PATH || (process.env.VERCEL ? path.join('/tmp', 'stripe_system.db') : path.join(process.cwd(), 'data', 'stripe_system.db')),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_placeholder',
  simulatorEnabled: process.env.SIMULATOR_ENABLED !== 'false',
  isStripeConfigured: Boolean(isStripeConfigured),
};
