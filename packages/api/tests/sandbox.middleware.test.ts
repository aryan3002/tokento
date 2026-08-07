import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { deploymentIsSandbox, requireSandboxContext } from '../src/middleware/sandbox.middleware';

describe('sandbox context', () => {
  it('reads the deployment flag from SANDBOX_MODE', () => {
    process.env.SANDBOX_MODE = 'true';
    expect(deploymentIsSandbox()).toBe(true);
    process.env.SANDBOX_MODE = 'false';
    expect(deploymentIsSandbox()).toBe(false);
  });

  it('returns the context established during authentication', () => {
    expect(requireSandboxContext({ isSandbox: true } as Request)).toBe(true);
    expect(requireSandboxContext({ isSandbox: false } as Request)).toBe(false);
  });

  it('throws rather than guessing when authentication established no context', () => {
    // A missing value means the route was wired without auth. Defaulting here would
    // let sandbox and production tokens mix on a money path.
    expect(() => requireSandboxContext({} as Request)).toThrowError(
      expect.objectContaining({ statusCode: 500, code: 'sandbox_unresolved' }),
    );
  });
});
