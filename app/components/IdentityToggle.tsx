"use client";

import { useState } from "react";
import { useApp } from "@/lib/run/AppContext";
import UsernamePrompt from "./UsernamePrompt";

/**
 * Anonymous / post-as-me switch for composers. Owns the lazy username prompt:
 * flipping to "as me" without a handle opens it, and only flips once a handle
 * exists. Parent reads the current choice via `value` / `onChange`.
 */
export default function IdentityToggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean; // true = post as me
  onChange: (asMe: boolean) => void;
  disabled?: boolean;
}) {
  const { username } = useApp();
  const [promptOpen, setPromptOpen] = useState(false);

  const chooseMe = () => {
    if (username) onChange(true);
    else setPromptOpen(true); // pick a handle first
  };

  return (
    <div className="identity-toggle" role="group" aria-label="Post as">
      <button
        type="button"
        className={`identity-opt ${!value ? "is-active" : ""}`}
        onClick={() => onChange(false)}
        disabled={disabled}
      >
        🕶 Anonymous
      </button>
      <button
        type="button"
        className={`identity-opt ${value ? "is-active" : ""}`}
        onClick={chooseMe}
        disabled={disabled}
      >
        {username ? `@${username}` : "Post as yourself"}
      </button>
      {username && (
        <button
          type="button"
          className="identity-edit"
          onClick={() => setPromptOpen(true)}
          disabled={disabled}
          title="Change username"
        >
          edit
        </button>
      )}

      <UsernamePrompt
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        onSaved={() => onChange(true)}
        reason="Pick the handle you'll post under. You can still post anonymously anytime."
      />
    </div>
  );
}
