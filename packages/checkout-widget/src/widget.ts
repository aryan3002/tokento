interface TokentoOAuthResult {
  type: 'tokento_oauth_result';
  state: string;
  merchantId?: string;
  customerId?: string;
  walletToken?: string;
  fallback?: boolean;
  error?: string;
  message?: string;
}

interface TokentoWidgetConfig {
  merchantId: string;
  customerId: string;
  apiBaseUrl?: string;
  theme?: 'light' | 'dark';
  position?: 'bottom-right' | 'bottom-left' | 'inline';
  containerId?: string;
  onConnected?: (result: TokentoOAuthResult) => void;
}

interface TokentoWidget {
  init: (config: TokentoWidgetConfig) => void;
  destroy: () => void;
}

(function () {
  const DEFAULT_API_BASE = 'http://localhost:4000';
  const STATE_ENDPOINT = '/api/v1/auth/b2c/widget/state';
  const POPUP_WIDTH = 460;
  const POPUP_HEIGHT = 620;

  const STYLES = `
    .tokento-widget{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;position:fixed;bottom:24px;right:24px;z-index:99999;max-width:360px;width:100%}
    .tokento-widget.bottom-left{right:auto;left:24px}
    .tokento-widget.inline{position:relative;bottom:auto;right:auto}
    .tokento-card{background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.12);padding:24px;border:1px solid #e5e7eb;animation:tokento-slide-up .25s ease-out;position:relative}
    .tokento-card.dark{background:#111827;color:#e5e7eb;border-color:#374151}
    .tokento-title{font-size:16px;font-weight:600;margin:0 0 8px;color:#111827}
    .tokento-card.dark .tokento-title{color:#f9fafb}
    .tokento-desc{font-size:14px;color:#6b7280;margin:0 0 16px;line-height:1.45}
    .tokento-card.dark .tokento-desc{color:#9ca3af}
    .tokento-btn{width:100%;padding:12px 18px;border:0;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;transition:opacity .15s}
    .tokento-btn:hover{opacity:.9}
    .tokento-btn:disabled{opacity:.55;cursor:not-allowed}
    .tokento-dismiss{position:absolute;top:10px;right:10px;background:none;border:none;color:#9ca3af;cursor:pointer;font-size:18px;line-height:1}
    .tokento-success{text-align:center;padding:8px 0}
    @keyframes tokento-slide-up{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
  `;

  let container: HTMLElement | null = null;
  let popupPoller: number | null = null;

  const widget: TokentoWidget = {
    init(config: TokentoWidgetConfig) {
      if (!document.getElementById('tokento-styles')) {
        const style = document.createElement('style');
        style.id = 'tokento-styles';
        style.textContent = STYLES;
        document.head.appendChild(style);
      }

      container = document.createElement('div');
      container.className = `tokento-widget ${config.position || 'bottom-right'}`;

      const themeClass = config.theme === 'dark' ? ' dark' : '';
      container.innerHTML = `
        <div class="tokento-card${themeClass}" id="tokento-card">
          <button class="tokento-dismiss" id="tokento-dismiss" aria-label="Dismiss">&times;</button>
          <p class="tokento-title">Rewards available</p>
          <p class="tokento-desc">Connect your AI shopping assistant to apply Tokento rewards automatically at checkout.</p>
          <button class="tokento-btn" id="tokento-connect">Connect AI Assistant</button>
        </div>
      `;

      if (config.containerId) {
        const target = document.getElementById(config.containerId);
        if (target) {
          container.className = 'tokento-widget inline';
          target.appendChild(container);
        } else {
          document.body.appendChild(container);
        }
      } else {
        document.body.appendChild(container);
      }

      const connectBtn = document.getElementById('tokento-connect') as HTMLButtonElement | null;
      const dismissBtn = document.getElementById('tokento-dismiss');

      connectBtn?.addEventListener('click', async () => {
        if (!connectBtn) return;
        connectBtn.disabled = true;
        connectBtn.textContent = 'Opening OAuth…';

        try {
          const apiBaseUrl = (config.apiBaseUrl || DEFAULT_API_BASE).replace(/\/+$/, '');
          const stateResponse = await fetch(`${apiBaseUrl}${STATE_ENDPOINT}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              merchantId: config.merchantId,
              customerId: config.customerId,
              origin: window.location.origin,
            }),
          });

          if (!stateResponse.ok) {
            throw new Error('state_request_failed');
          }

          const stateBody = await stateResponse.json() as { state?: string; authorizeUrl?: string };
          if (!stateBody.state || !stateBody.authorizeUrl) {
            throw new Error('invalid_state_response');
          }

          connectBtn.textContent = 'Waiting for consent…';
          await openOAuthPopup(stateBody.authorizeUrl, apiBaseUrl, stateBody.state, config);

          const card = document.getElementById('tokento-card');
          if (card) {
            card.innerHTML = `
              <div class="tokento-success">
                <p class="tokento-title">Connected</p>
                <p class="tokento-desc">Your wallet token is now available to the agent handoff flow.</p>
              </div>
            `;
          }
        } catch {
          connectBtn.disabled = false;
          connectBtn.textContent = 'Try Again';
        }
      });

      dismissBtn?.addEventListener('click', () => widget.destroy());
    },

    destroy() {
      if (popupPoller !== null) {
        window.clearInterval(popupPoller);
        popupPoller = null;
      }
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
        container = null;
      }
    },
  };

  function centerPopupFeatures(): string {
    const dualScreenLeft = window.screenLeft ?? 0;
    const dualScreenTop = window.screenTop ?? 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || screen.width;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || screen.height;
    const left = Math.max(0, dualScreenLeft + (viewportWidth - POPUP_WIDTH) / 2);
    const top = Math.max(0, dualScreenTop + (viewportHeight - POPUP_HEIGHT) / 2);
    return `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${Math.floor(left)},top=${Math.floor(top)},resizable=yes,scrollbars=yes`;
  }

  async function openOAuthPopup(
    authorizeUrl: string,
    apiBaseUrl: string,
    state: string,
    config: TokentoWidgetConfig
  ): Promise<void> {
    const expectedOrigin = new URL(apiBaseUrl).origin;
    const popup = window.open(authorizeUrl, 'tokento_oauth_popup', centerPopupFeatures());
    if (!popup) {
      throw new Error('popup_blocked');
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        if (popupPoller !== null) {
          window.clearInterval(popupPoller);
          popupPoller = null;
        }
        window.removeEventListener('message', onMessage);
      };

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== expectedOrigin) {
          return;
        }

        const data = event.data as TokentoOAuthResult;
        if (!data || data.type !== 'tokento_oauth_result' || data.state !== state) {
          return;
        }

        if (data.error || !data.walletToken) {
          settle(() => reject(new Error(data.error || 'oauth_failed')));
          return;
        }

        try {
          const storagePayload = {
            walletToken: data.walletToken,
            customerId: data.customerId || config.customerId,
            merchantId: data.merchantId || config.merchantId,
            fallback: Boolean(data.fallback),
            receivedAt: new Date().toISOString(),
          };

          window.localStorage.setItem('tokento_wallet_token', JSON.stringify(storagePayload));
          window.dispatchEvent(new CustomEvent('tokento:connected', { detail: storagePayload }));
          config.onConnected?.(data);
        } catch {
          // ignore localStorage failures; OAuth flow has still succeeded.
        }

        settle(() => resolve());
      };

      window.addEventListener('message', onMessage);

      popupPoller = window.setInterval(() => {
        if (popup.closed) {
          settle(() => reject(new Error('oauth_cancelled')));
        }
      }, 400);
    });
  }

  (window as unknown as { Tokento: TokentoWidget }).Tokento = widget;
})();
