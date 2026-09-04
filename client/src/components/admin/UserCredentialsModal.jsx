import { useState } from "react";
import { FiEye, FiEyeOff, FiLock, FiMail, FiUser } from "react-icons/fi";
import Modal from "../ui/Modal";
import Avatar from "../ui/Avatar";
import Badge, { statusVariant } from "../ui/Badge";
import CopyField from "../ui/CopyField";
import Button from "../ui/Button";

export default function UserCredentialsModal({ open, onClose, user }) {
  const [revealed, setRevealed] = useState(false);

  if (!user) return null;

  const creds = user.credentials || {};
  const hasPassword = Boolean(creds.password);
  const passwordDisplay = hasPassword
    ? revealed
      ? creds.password
      : "••••••••••••"
    : null;

  return (
    <Modal
      open={open}
      onClose={() => {
        setRevealed(false);
        onClose();
      }}
      title="User Credentials"
      size="md"
    >
      <div className="space-y-6">
        {/* User Identity Header */}
        <div className="flex items-center gap-3.5 rounded-lg border border-cool-grey bg-mist/40 p-4">
          <Avatar
            name={user.username}
            src={user.avatarUrl || user.image}
            size={44}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-void truncate">
                {user.displayName || user.username}
              </span>
              <Badge variant={statusVariant(user.status)}>{user.status}</Badge>
              {user.role === "admin" && <Badge variant="amber">Admin</Badge>}
            </div>
            <span className="font-mono text-xs text-text-muted truncate block">
              @{user.username}
            </span>
          </div>
        </div>

        {/* Credentials Details List */}
        <div className="space-y-3.5">
          {/* Email */}
          <div className="rounded-lg border border-cool-grey/60 bg-white p-3.5 shadow-sm">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase">
              <FiMail size={13} className="text-text-muted" />
              <span>Email Address</span>
            </div>
            <CopyField value={user.email} label="Email" />
          </div>

          {/* Username */}
          <div className="rounded-lg border border-cool-grey/60 bg-white p-3.5 shadow-sm">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase">
              <FiUser size={13} className="text-text-muted" />
              <span>Username</span>
            </div>
            <CopyField value={user.username} label="Username" />
          </div>

          {/* Password */}
          <div className="rounded-lg border border-cool-grey/60 bg-white p-3.5 shadow-sm">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted uppercase">
                <FiLock size={13} className="text-text-muted" />
                <span>Signup Password</span>
              </div>
              {hasPassword && (
                <button
                  type="button"
                  onClick={() => setRevealed((v) => !v)}
                  className="inline-flex cursor-pointer items-center gap-1 text-xs text-gain hover:underline"
                >
                  {revealed ? (
                    <>
                      <FiEyeOff size={13} />
                      <span>Hide</span>
                    </>
                  ) : (
                    <>
                      <FiEye size={13} />
                      <span>Reveal</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {hasPassword ? (
              revealed ? (
                <CopyField value={creds.password} label="Password" />
              ) : (
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm tracking-widest text-text-muted">
                    {passwordDisplay}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRevealed(true)}
                    className="text-xs font-medium text-void underline underline-offset-2 hover:text-gain cursor-pointer"
                  >
                    Click to reveal & copy
                  </button>
                </div>
              )
            ) : creds.provider === "google" ? (
              <p className="m-0 text-xs text-text-muted">
                Signed up via Google OAuth (no password stored).
              </p>
            ) : user.canSignIn ? (
              <p className="m-0 text-xs text-text-muted">
                Standard credential account. Password hash stored securely.
              </p>
            ) : (
              <p className="m-0 text-xs text-text-muted">
                Leaderboard fixture trader (no sign-in credential).
              </p>
            )}
          </div>

          {/* Provider and Creation info */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-cool-grey/40 bg-mist/30 p-3">
              <span className="text-2xs text-text-muted uppercase block font-semibold">
                Sign-In Provider
              </span>
              <span className="mt-1 font-medium text-void block capitalize">
                {creds.provider || (user.canSignIn ? "Email & Password" : "None")}
              </span>
            </div>
            <div className="rounded-lg border border-cool-grey/40 bg-mist/30 p-3">
              <span className="text-2xs text-text-muted uppercase block font-semibold">
                Joined Date
              </span>
              <span className="mt-1 font-medium text-void block">
                {user.createdAt
                  ? new Date(user.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })
                  : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
