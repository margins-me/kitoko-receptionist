"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { useBrandProps } from "./brand";
import { IconButton } from "./icon-button";
import { keepEscForDialog } from "./sheet";
import { useBackToClose } from "./use-back-to-close";
import { useReturnFocus } from "./use-return-focus";

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  closeLabel: string;
  eyebrow?: ReactNode;
  /** Left half on wide screens, top on narrow ones (e.g. the product photo). */
  media?: ReactNode;
  children?: ReactNode;
  /**
   * Browser/OS back closes the dialog (one same-URL history entry while open). Default true; pass false when
   * the caller already keeps this dialog's open state in history.
   */
  backToClose?: boolean;
};

/** Centred 860 px dialog, e.g. product detail on desktop. */
export function Dialog({ open, onOpenChange, title, closeLabel, eyebrow, media, children, backToClose = true }: DialogProps) {
  useBackToClose(open, onOpenChange, backToClose);
  const brandProps = useBrandProps();
  const returnFocus = useReturnFocus(open);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-scrim p-4 data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in desk:p-8">
          <RadixDialog.Content
            onCloseAutoFocus={returnFocus}
            onEscapeKeyDown={keepEscForDialog}
            aria-describedby={undefined}
            {...brandProps}
            className="relative z-50 flex max-h-full w-[860px] max-w-full flex-wrap overflow-y-auto rounded-sheet bg-surface shadow-modal outline-none data-[state=open]:animate-pop-in"
          >
            {media && <div className="flex min-h-80 flex-[1_1_320px] items-center justify-center overflow-hidden">{media}</div>}
            <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 p-7">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  {eyebrow && <span className="text-caption text-muted">{eyebrow}</span>}
                  <RadixDialog.Title className="text-[26px] leading-[1.15] font-semibold tracking-[-0.03em]">{title}</RadixDialog.Title>
                </div>
                <RadixDialog.Close asChild>
                  <IconButton label={closeLabel} variant="soft">
                    <X aria-hidden strokeWidth={2.2} />
                  </IconButton>
                </RadixDialog.Close>
              </div>
              {children}
            </div>
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
