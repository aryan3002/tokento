import { B2BClient, Client, envs } from 'stytch';
import prisma from '../db/client';

const STYTCH_PROJECT_ID = process.env.STYTCH_PROJECT_ID || 'test-project';
const STYTCH_SECRET = process.env.STYTCH_SECRET || 'test-secret';
const STYTCH_ENV = process.env.STYTCH_ENV === 'live' ? envs.live : envs.test;

const b2bClient = new B2BClient({
  project_id: STYTCH_PROJECT_ID,
  secret: STYTCH_SECRET,
  env: STYTCH_ENV,
});

const b2cClient = new Client({
  project_id: STYTCH_PROJECT_ID,
  secret: STYTCH_SECRET,
  env: STYTCH_ENV,
});

export function usingPlaceholderStytchConfig(): boolean {
  return STYTCH_PROJECT_ID === 'test-project' && STYTCH_SECRET === 'test-secret';
}

function parseDevB2BToken(sessionJwt: string): {
  merchantId: string;
  memberId: string;
  organizationId: string;
} | null {
  const prefix = 'b2b_dev_session::';
  if (!sessionJwt.startsWith(prefix)) return null;

  const merchantId = sessionJwt.slice(prefix.length).trim();
  if (!merchantId) return null;

  return {
    merchantId,
    memberId: `dev-member:${merchantId}`,
    organizationId: 'dev-organization',
  };
}

function parseDevB2CToken(sessionJwt: string): {
  customerId: string;
  userId: string;
} | null {
  const prefix = 'b2c_dev_session::';
  if (!sessionJwt.startsWith(prefix)) return null;

  const customerId = sessionJwt.slice(prefix.length).trim();
  if (!customerId) return null;

  return {
    customerId,
    userId: `dev-user:${customerId}`,
  };
}

export async function authenticateB2BSessionJwt(sessionJwt: string): Promise<{
  merchantId: string;
  memberId: string;
  organizationId: string;
  fallback: boolean;
}> {
  const devSession = parseDevB2BToken(sessionJwt);
  if (devSession) {
    return { ...devSession, fallback: true };
  }

  const response = await b2bClient.sessions.authenticateJwt({
    session_jwt: sessionJwt,
  });

  const claims = response.member_session.custom_claims || {};
  const merchantId = typeof claims.merchant_id === 'string'
    ? claims.merchant_id
    : null;

  if (!merchantId) {
    throw new Error('stytch_b2b_missing_merchant_claim');
  }

  return {
    merchantId,
    memberId: response.member_session.member_id,
    organizationId: response.member_session.organization_id,
    fallback: false,
  };
}

export async function authenticateB2CSessionJwt(sessionJwt: string): Promise<{
  customerId: string;
  userId: string;
  fallback: boolean;
}> {
  const devSession = parseDevB2CToken(sessionJwt);
  if (devSession) {
    return { ...devSession, fallback: true };
  }

  const response = await b2cClient.sessions.authenticateJwt({
    session_jwt: sessionJwt,
  });

  const claims = response.session.custom_claims || {};
  const customerId = typeof claims.customer_id === 'string'
    ? claims.customer_id
    : null;

  if (!customerId) {
    throw new Error('stytch_b2c_missing_customer_claim');
  }

  return {
    customerId,
    userId: response.session.user_id,
    fallback: false,
  };
}

export async function createDevB2BSessionJwt(merchantId?: string): Promise<{
  sessionJwt: string;
  merchantId: string;
}> {
  if (!usingPlaceholderStytchConfig()) {
    throw new Error('stytch_dev_session_disabled_without_placeholder_config');
  }

  let resolvedMerchantId = merchantId;

  if (!resolvedMerchantId) {
    const merchant = await prisma.merchant.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!merchant) {
      throw new Error('no_merchant_available_for_dev_session');
    }
    resolvedMerchantId = merchant.id;
  }

  return {
    sessionJwt: `b2b_dev_session::${resolvedMerchantId}`,
    merchantId: resolvedMerchantId,
  };
}
