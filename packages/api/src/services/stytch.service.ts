import { B2BClient, Client, envs } from 'stytch';
import prisma from '../db/client';

const STYTCH_PROJECT_ID = process.env.STYTCH_PROJECT_ID || 'test-project';
const STYTCH_SECRET = process.env.STYTCH_SECRET || 'test-secret';
const STYTCH_B2B_PROJECT_ID = process.env.STYTCH_B2B_PROJECT_ID || STYTCH_PROJECT_ID;
const STYTCH_B2B_SECRET = process.env.STYTCH_B2B_SECRET || STYTCH_SECRET;
const STYTCH_B2B_ORGANIZATION_ID = process.env.STYTCH_B2B_ORGANIZATION_ID || '';
const STYTCH_ENV = process.env.STYTCH_ENV === 'live' ? envs.live : envs.test;

const b2bClient = new B2BClient({
  project_id: STYTCH_B2B_PROJECT_ID,
  secret: STYTCH_B2B_SECRET,
  env: STYTCH_ENV,
});

const b2cClient = new Client({
  project_id: STYTCH_PROJECT_ID,
  secret: STYTCH_SECRET,
  env: STYTCH_ENV,
});

export function usingPlaceholderStytchConfig(): boolean {
  return usingPlaceholderB2CConfig() && usingPlaceholderB2BConfig();
}

export function usingPlaceholderB2CConfig(): boolean {
  return STYTCH_PROJECT_ID === 'test-project' && STYTCH_SECRET === 'test-secret';
}

export function usingPlaceholderB2BConfig(): boolean {
  return STYTCH_B2B_PROJECT_ID === 'test-project' && STYTCH_B2B_SECRET === 'test-secret';
}

export function getStytchB2BOrganizationId(): string | null {
  return STYTCH_B2B_ORGANIZATION_ID || null;
}

/**
 * Dev session tokens (`b2c_dev_session::<id>` / `b2b_dev_session::<id>`) name their own
 * principal, so accepting one is equivalent to accepting an unauthenticated request.
 * They are permitted only when BOTH conditions hold: we are not in production, and the
 * corresponding Stytch client is still on placeholder credentials.
 */
function assertDevSessionAllowed(kind: 'b2c' | 'b2b'): void {
  const notProduction = process.env.NODE_ENV !== 'production';
  const placeholderConfig = kind === 'b2c'
    ? usingPlaceholderB2CConfig()
    : usingPlaceholderB2BConfig();

  if (!notProduction || !placeholderConfig) {
    throw new Error(`dev_session_forbidden:${kind}`);
  }
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
    assertDevSessionAllowed('b2b');
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
    assertDevSessionAllowed('b2c');
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
  if (!usingPlaceholderB2BConfig()) {
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

export async function createDevB2CSessionJwt(customerId: string): Promise<{
  sessionJwt: string;
  customerId: string;
}> {
  if (!usingPlaceholderB2CConfig()) {
    throw new Error('stytch_dev_session_disabled_without_placeholder_config');
  }

  const resolvedCustomerId = customerId.trim();
  if (!resolvedCustomerId) {
    throw new Error('missing_customer_for_dev_session');
  }

  return {
    sessionJwt: `b2c_dev_session::${resolvedCustomerId}`,
    customerId: resolvedCustomerId,
  };
}

export async function resolveDashboardMerchantId(merchantId?: string): Promise<string> {
  if (merchantId) {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true },
    });
    if (!merchant) {
      throw new Error('merchant_not_found');
    }
    return merchant.id;
  }

  const merchant = await prisma.merchant.findFirst({
    where: { isSandbox: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (!merchant) {
    throw new Error('no_merchant_available_for_auth');
  }

  return merchant.id;
}

export async function sendB2BMagicLink(params: {
  email: string;
  redirectUrl: string;
}): Promise<{
  sent: true;
  organizationId: string;
}> {
  const organizationId = getStytchB2BOrganizationId();
  if (!organizationId) {
    throw new Error('stytch_b2b_organization_missing');
  }

  await b2bClient.magicLinks.email.loginOrSignup({
    organization_id: organizationId,
    email_address: params.email,
    login_redirect_url: params.redirectUrl,
    signup_redirect_url: params.redirectUrl,
  });

  return {
    sent: true,
    organizationId,
  };
}

export async function authenticateB2BMagicLink(params: {
  magicLinksToken: string;
  merchantId: string;
  sessionDurationMinutes?: number;
}): Promise<{
  sessionJwt: string;
  merchantId: string;
  memberId: string;
  organizationId: string;
  fallback: false;
}> {
  const response = await b2bClient.magicLinks.authenticate({
    magic_links_token: params.magicLinksToken,
    session_duration_minutes: params.sessionDurationMinutes || 60,
    session_custom_claims: {
      merchant_id: params.merchantId,
    },
  });

  return {
    sessionJwt: response.session_jwt,
    merchantId: params.merchantId,
    memberId: response.member_id,
    organizationId: response.organization_id,
    fallback: false,
  };
}

export async function sendB2CMagicLink(params: {
  email: string;
  redirectUrl: string;
}): Promise<{
  sent: true;
}> {
  await b2cClient.magicLinks.email.loginOrCreate({
    email: params.email,
    login_magic_link_url: params.redirectUrl,
    signup_magic_link_url: params.redirectUrl,
  });

  return { sent: true };
}

export async function authenticateB2CMagicLink(params: {
  token: string;
  customerId: string;
  sessionDurationMinutes?: number;
}): Promise<{
  sessionJwt: string;
  customerId: string;
  userId: string;
  fallback: false;
}> {
  const response = await b2cClient.magicLinks.authenticate({
    token: params.token,
    session_duration_minutes: params.sessionDurationMinutes || 60,
    session_custom_claims: {
      customer_id: params.customerId,
    },
  });

  return {
    sessionJwt: response.session_jwt,
    customerId: params.customerId,
    userId: response.user_id,
    fallback: false,
  };
}
