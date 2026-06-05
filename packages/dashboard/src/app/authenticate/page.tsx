"use client";

import { useEffect, useRef } from "react";

const B2B_SESSION_STORAGE_KEY = "tokento_b2b_session_jwt";

export default function AuthenticatePage() {
  const messageRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const sessionJwt = hash.get("sessionJwt");

    if (!sessionJwt) {
      if (messageRef.current) {
        messageRef.current.textContent = "No Stytch session was returned. Request a new magic link from Settings.";
      }
      return;
    }

    window.localStorage.setItem(B2B_SESSION_STORAGE_KEY, sessionJwt);
    window.history.replaceState(null, "", "/authenticate");
    if (messageRef.current) {
      messageRef.current.textContent = "Session saved. Redirecting...";
    }
    window.setTimeout(() => {
      window.location.assign("/");
    }, 250);
  }, []);

  return (
    <main className="min-h-screen bg-surface-0 text-text-primary grid place-items-center px-6">
      <section className="glass rounded-xl p-6 max-w-md w-full">
        <h1 className="text-lg font-semibold mb-2">Stytch sign in</h1>
        <p ref={messageRef} className="text-sm text-text-muted">Completing sign in...</p>
      </section>
    </main>
  );
}
