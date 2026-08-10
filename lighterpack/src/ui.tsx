import React from "react";

/** Minimal stand-ins for former @patchwork/sdk/ui (className carries styling). */
export function Button({
  className = "",
  variant: _v,
  size: _s,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  size?: string;
}) {
  return <button type="button" className={className} {...props} />;
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = "", ...props }, ref) {
  return (
    <input
      ref={ref}
      className={`lp-field ${className}`}
      {...props}
    />
  );
});
