import React, { useEffect, useState } from "react";

export { Icon } from "./icons";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type DialogContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

export function Dialog({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  };

  return (
    <DialogContext.Provider value={{ open, setOpen }}>
      {children}
    </DialogContext.Provider>
  );
}

export function DialogTrigger({
  children,
  asChild,
}: {
  children: React.ReactNode;
  asChild?: boolean;
}) {
  const ctx = React.useContext(DialogContext);
  if (!ctx) return <>{children}</>;

  const onClick = () => ctx.setOpen(true);

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{
      onClick?: (event: React.MouseEvent) => void;
    }>;
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent) => {
        child.props.onClick?.(event);
        event.stopPropagation();
        onClick();
      },
    });
  }

  return (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  );
}

export function DialogContent({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = React.useContext(DialogContext);
  if (!ctx?.open) return null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") ctx.setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ctx]);

  return (
    <div className="lanes dialog-backdrop">
      <div
        className={cn("dialog", className)}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog__head">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => ctx.setOpen(false)}
          >
            Close
          </button>
        </div>
        <div className="dialog__body">{children}</div>
      </div>
    </div>
  );
}

export const Button = (
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  },
) => {
  const { variant: _v, size: _s, ...rest } = props;
  return <button type="button" {...rest} />;
};

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input(props, ref) {
  return <input ref={ref} {...props} />;
});
