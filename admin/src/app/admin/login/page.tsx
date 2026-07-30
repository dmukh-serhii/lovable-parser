"use client";

import { FormEvent, useState } from "react";
import { Logo } from "@/components/logo";
import { Button, Card, Spinner } from "@/components/ui";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Login failed");
      }
      // hard navigation — the client router cache holds the pre-login
      // redirect for /admin, so a soft replace would bounce back here
      window.location.assign("/admin");
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex justify-center">
          <Logo />
        </div>
        <h1 className="mb-4 text-center text-sm font-semibold text-ink">
          Admin sign in
        </h1>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="email"
            required
            autoFocus
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-line-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-line-strong bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          {error && <p className="text-sm text-bad-text">{error}</p>}
          <Button variant="primary" type="submit" disabled={busy} className="mt-1">
            {busy ? <Spinner /> : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
