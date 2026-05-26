// ============================================================
// Tokento — Checkout Handoff Widget (Revision #1)
// ============================================================
// Vanilla TS, <10KB, embeddable via <script> tag.
// Merchant checkout page → one-tap → OAuth grant → agent can query wallet.
//
// Bootstrap Mechanism M1: Merchant checkout handoff.
// See vault: Bootstrap Mechanisms.md

interface TokentoWidgetConfig {
  merchantId: string;
  customerId: string;
  apiBaseUrl?: string;
  theme?: 'light' | 'dark';
  position?: 'bottom-right' | 'bottom-left' | 'inline';
  containerId?: string;
}

interface TokentoWidget {
  init: (config: TokentoWidgetConfig) => void;
  destroy: () => void;
}

(function () {
  const DEFAULT_API_BASE = 'https://api.tokento.com';

  // Styles injected inline for zero-dependency embed
  const STYLES = `
    .tokento-widget {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      max-width: 360px;
      width: 100%;
    }
    .tokento-widget.bottom-left {
      right: auto;
      left: 24px;
    }
    .tokento-widget.inline {
      position: relative;
      bottom: auto;
      right: auto;
    }
    .tokento-card {
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12);
      padding: 24px;
      border: 1px solid #e5e7eb;
      animation: tokento-slide-up 0.3s ease-out;
    }
    .tokento-card.dark {
      background: #1a1a2e;
      color: #e5e7eb;
      border-color: #2d2d4a;
    }
    .tokento-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0 0 8px;
      color: #111;
    }
    .tokento-card.dark .tokento-title { color: #f3f4f6; }
    .tokento-desc {
      font-size: 14px;
      color: #6b7280;
      margin: 0 0 16px;
      line-height: 1.5;
    }
    .tokento-card.dark .tokento-desc { color: #9ca3af; }
    .tokento-btn {
      width: 100%;
      padding: 12px 20px;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff;
      transition: opacity 0.15s;
    }
    .tokento-btn:hover { opacity: 0.9; }
    .tokento-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .tokento-dismiss {
      position: absolute;
      top: 12px;
      right: 12px;
      background: none;
      border: none;
      color: #9ca3af;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
    }
    .tokento-success {
      text-align: center;
      padding: 8px 0;
    }
    .tokento-success-icon {
      font-size: 32px;
      margin-bottom: 8px;
    }
    @keyframes tokento-slide-up {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
  `;

  let container: HTMLElement | null = null;

  const widget: TokentoWidget = {
    init(config: TokentoWidgetConfig) {
      // Inject styles
      if (!document.getElementById('tokento-styles')) {
        const style = document.createElement('style');
        style.id = 'tokento-styles';
        style.textContent = STYLES;
        document.head.appendChild(style);
      }

      // Create widget container
      container = document.createElement('div');
      container.className = `tokento-widget ${config.position || 'bottom-right'}`;

      const themeClass = config.theme === 'dark' ? ' dark' : '';
      container.innerHTML = `
        <div class="tokento-card${themeClass}" id="tokento-card">
          <button class="tokento-dismiss" id="tokento-dismiss">&times;</button>
          <p class="tokento-title">🎁 You earned rewards!</p>
          <p class="tokento-desc">Connect your AI shopping assistant so your rewards apply automatically next time.</p>
          <button class="tokento-btn" id="tokento-connect">Connect AI Assistant</button>
        </div>
      `;

      // Mount
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

      // Event listeners
      const connectBtn = document.getElementById('tokento-connect');
      const dismissBtn = document.getElementById('tokento-dismiss');

      connectBtn?.addEventListener('click', async () => {
        connectBtn.setAttribute('disabled', 'true');
        connectBtn.textContent = 'Connecting...';

        try {
          // MVP: Simulate OAuth flow
          // In production, this opens the agent platform's OAuth consent screen
          await simulateOAuthFlow(config);

          const card = document.getElementById('tokento-card');
          if (card) {
            card.innerHTML = `
              <div class="tokento-success">
                <div class="tokento-success-icon">✅</div>
                <p class="tokento-title">Connected!</p>
                <p class="tokento-desc">Your AI assistant can now apply your rewards automatically.</p>
              </div>
            `;
            setTimeout(() => widget.destroy(), 3000);
          }
        } catch (err) {
          connectBtn.removeAttribute('disabled');
          connectBtn.textContent = 'Try Again';
        }
      });

      dismissBtn?.addEventListener('click', () => widget.destroy());
    },

    destroy() {
      if (container && container.parentNode) {
        container.parentNode.removeChild(container);
        container = null;
      }
    },
  };

  async function simulateOAuthFlow(config: TokentoWidgetConfig): Promise<void> {
    // MVP: Create a simple wallet-agent association
    // Production: Opens agent platform OAuth consent screen
    const apiBase = config.apiBaseUrl || DEFAULT_API_BASE;

    // For MVP demo, just log the connection
    console.log('[Tokento] Widget connected:', {
      merchantId: config.merchantId,
      customerId: config.customerId,
    });

    // Simulate network delay
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Expose globally
  (window as any).Tokento = widget;
})();
