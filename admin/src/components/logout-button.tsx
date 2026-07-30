"use client";

import { Button } from "./ui";

export function LogoutButton() {
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        // hard navigation clears the authed router cache
        window.location.assign("/");
      }}
    >
      Sign out
    </Button>
  );
}
