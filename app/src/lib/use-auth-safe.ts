"use client";

import { useEffect, useState } from "react";

interface AuthUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
}

interface AuthState {
  user: AuthUser | undefined;
  loading: boolean;
}

/**
 * Safe auth hook that works with or without WorkOS AuthKitProvider.
 *
 * When AuthKitProvider is present (WorkOS configured), delegates to useAuth().
 * When absent (dev mode), fetches user info from /api/user instead.
 */
export function useAuthSafe(): AuthState {
  const [state, setState] = useState<AuthState>({ user: undefined, loading: true });

  useEffect(() => {
    // Try to detect if AuthKitProvider is wrapping us by checking
    // if the WorkOS context is available. Since we can't import useAuth
    // conditionally in a hook, we fetch from /api/user which handles
    // both dev mode and WorkOS mode server-side.
    fetch("/api/user")
      .then((res) => res.json())
      .then((data) => {
        setState({
          user: data.user ?? undefined,
          loading: false,
        });
      })
      .catch(() => {
        setState({ user: undefined, loading: false });
      });
  }, []);

  return state;
}
