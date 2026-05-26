// ============================================================
// Tokento — Database Seed Script
// ============================================================
import dotenv from 'dotenv';
import path from 'path';
// Load .env from the monorepo root (Token/.env), not packages/api/.env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Tokento database...\n');

  // Create test merchant
  const merchant = await prisma.merchant.upsert({
    where: { email: 'demo@coffeeco.com' },
    update: {},
    create: {
      name: 'Coffee Co.',
      email: 'demo@coffeeco.com',
      agentOptIn: true,
      settlementType: 'discount',
      settlementTiming: 'real_time',
      isSandbox: true,
    },
  });
  console.log(`✅ Merchant: ${merchant.name} (${merchant.id})`);

  // Create API key for merchant.
  // In dev, prefer a deterministic key from DEV_FIXED_API_KEY so the dashboard
  // and any local scripts stay wired across reseeds. Generate a fresh random
  // key only if the env var is unset.
  const rawKey =
    process.env.DEV_FIXED_API_KEY ||
    `tk_${crypto.randomBytes(48).toString('base64url')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const apiKey = await prisma.apiKey.upsert({
    where: { keyHash },
    update: {},
    create: {
      merchantId: merchant.id,
      keyPrefix: rawKey.substring(0, 8),
      keyHash,
      scopes: ['tokens:mint', 'tokens:read', 'tokens:validate', 'tokens:redeem', 'merchants:read', 'merchants:write', 'earn_rules:read', 'earn_rules:write', 'webhooks:read', 'webhooks:write', 'audit:read'],
      rateLimit: 100,
      isSandbox: true,
    },
  });
  console.log(`✅ API Key: ${rawKey}`);
  console.log(`   Prefix: ${apiKey.keyPrefix}`);
  if (process.env.DEV_FIXED_API_KEY) {
    console.log('   (sourced from DEV_FIXED_API_KEY env var)');
  } else {
    console.log('   ⚠️  No DEV_FIXED_API_KEY set — this key changes every seed.');
    console.log('       Set DEV_FIXED_API_KEY in .env to keep the dashboard wired.');
  }

  // Create earn rules
  const rule1 = await prisma.earnRule.create({
    data: {
      merchantId: merchant.id,
      name: 'Spend $25, Get $5 Off',
      spendThreshold: 25,
      tokenDenomination: 5,
      expiryDays: 90,
      agentPresentableFlag: true,
      stackabilityFlag: true,
      minimumTransactionFloor: 10,
    },
  });
  console.log(`✅ Earn Rule: ${rule1.name} (${rule1.id})`);

  const rule2 = await prisma.earnRule.create({
    data: {
      merchantId: merchant.id,
      name: 'Spend $50, Get $12 Off',
      spendThreshold: 50,
      tokenDenomination: 12,
      expiryDays: 60,
      agentPresentableFlag: true,
      stackabilityFlag: true,
      minimumTransactionFloor: 20,
    },
  });
  console.log(`✅ Earn Rule: ${rule2.name} (${rule2.id})`);

  // Create test customer wallet
  const customerId = '11111111-1111-1111-1111-111111111111';
  const wallet = await prisma.wallet.upsert({
    where: { customerId },
    update: {},
    create: { customerId },
  });
  console.log(`✅ Wallet: ${customerId}`);

  // Mint test tokens
  const hmacKey = crypto.createHmac('sha256', process.env.HMAC_MASTER_KEY || 'dev-hmac-master-key-change-me').update(`merchant:${merchant.id}`).digest();

  for (let i = 0; i < 3; i++) {
    const tokenId = crypto.randomUUID();
    const expiryAt = new Date();
    expiryAt.setDate(expiryAt.getDate() + 90);

    const payload = [tokenId, merchant.id, customerId, '5', expiryAt.toISOString(), 'sandbox'].join(':');
    const signature = crypto.createHmac('sha256', hmacKey).update(payload).digest('hex');

    const token = await prisma.token.create({
      data: {
        id: tokenId,
        merchantId: merchant.id,
        customerId,
        earnRuleId: rule1.id,
        denomination: 5,
        tokenType: 'loyalty',
        status: 'ACTIVE',
        signature,
        idempotencyKey: `seed-${i}-${Date.now()}`,
        agentPresentableFlag: true,
        stackabilityFlag: true,
        minimumTransactionFloor: 10,
        expiryAt,
        isSandbox: true,
      },
    });
    console.log(`✅ Token: $${token.denomination} (${token.id})`);
  }

  console.log('\n🎉 Seed complete!\n');
  console.log('--- Test Credentials ---');
  console.log(`Merchant ID: ${merchant.id}`);
  console.log(`Customer ID: ${customerId}`);
  console.log(`API Key:     ${rawKey}`);
  console.log(`Earn Rule 1: ${rule1.id}`);
  console.log(`Earn Rule 2: ${rule2.id}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
