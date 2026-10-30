"use client";

import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { ChevronLeft, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { Drawer } from "vaul";
import { useBrandProps } from "./brand";
import { cn } from "./cn";
import { IconButton } from "./icon-button";
import { useBackToClose } from "./use-back-to-close";
import { useIsDesktop } from "./use-is-desktop";
import { useReturnFocus } from "./use-return-focus";

const DRAG_CLOSE_PX = 90;

/**
 * Esc in a native modal <dialog> opened from the sheet or a Dialog (the photo viewer) closes that dialog only. Radix
 * hears the key first (capture on document) and would close the sheet; keeping it open means preventDefault, which also
 * cancels the dialog's own Esc, so it is closed here.
 */
export const keepEscForDialog = (e: KeyboardEvent) => {
  const dialog = e.target instanceof Element ? e.target.closest("dialog[open]") : null;
  if (!(dialog instanceof HTMLDialogElement)) return;
  e.preventDefault();
  dialog.close();
};

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Accessible name of the X button, e.g. "Fermer". */
  closeLabel: string;
  /** A back button before the title, for a sheet whose content has a previous step (label e.g. "Retour aux options"); none without. */
  back?: { label: string; onClick: () => void };
  /** Small muted line above the title, e.g. "Étape 1 sur 3". */
  eyebrow?: ReactNode;
  /** Under the title, inside the header, e.g. <ProgressSteps />: kept off the body so it never reads as part of the content. */
  progress?: ReactNode;
  description?: ReactNode;
  /** Pinned under the scrolling body, e.g. <Summary /> and a <Button />. */
  footer?: ReactNode;
  children?: ReactNode;
  /**
   * Browser/OS back closes the sheet (one same-URL history entry while open). Default true; pass false when
   * the caller already keeps this sheet's open state in history.
   */
  backToClose?: boolean;
};

/** Bottom sheet below 860 px, 520 px right-hand panel at and above. */
export function Sheet(props: SheetProps) {
  // Here, not in Panel/BottomSheet: crossing 860 px swaps them and must keep the same history entry.
  useBackToClose(props.open, props.onOpenChange, props.backToClose ?? true);
  return useIsDesktop() ? <Panel {...props} /> : <BottomSheet {...props} />;
}

type Parts = {
  Title: ComponentType<{ className?: string; children?: ReactNode }>;
  Description: ComponentType<{ className?: string; children?: ReactNode }>;
  Close: ComponentType<{ asChild?: boolean; children?: ReactNode }>;
};

/** `large`: the desktop panel's bigger title (the bottom sheet only shows below 860 px). */
function Header({
  title,
  eyebrow,
  progress,
  description,
  closeLabel,
  back,
  parts,
  large,
  className,
}: Pick<SheetProps, "title" | "eyebrow" | "progress" | "description" | "closeLabel" | "back"> & { parts: Parts; large?: boolean; className?: string }) {
  const { Title, Description, Close } = parts;
  return (
    <div className={cn("flex shrink-0 flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-3">
        {back && (
          <IconButton label={back.label} variant="soft" onClick={back.onClick}>
            <ChevronLeft aria-hidden strokeWidth={2.2} />
          </IconButton>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {eyebrow && <span className="text-caption text-muted">{eyebrow}</span>}
          <Title className={cn("text-panel-title font-semibold", large && "desk:text-2xl/[1.15]")}>{title}</Title>
          {description && <Description className="mt-1 text-ui text-muted">{description}</Description>}
        </div>
        <Close asChild>
          <IconButton label={closeLabel} variant="soft">
            <X aria-hidden strokeWidth={2.2} />
          </IconButton>
        </Close>
      </div>
      {progress}
    </div>
  );
}

// The bottom sheet's parts, shared with <SheetPicture>.
const SHEET_BOX = "flex max-h-[92dvh] flex-col rounded-t-sheet bg-surface shadow-sheet outline-none";
const SHEET_HEAD = "flex shrink-0 flex-col gap-1.5 px-4 pt-2 pb-1";
const SHEET_GRIP = "h-1.25 w-10 self-center rounded-full bg-grip";
const SHEET_BODY = "flex min-h-0 flex-1 flex-col gap-4.5 overflow-y-auto px-4 pt-2 pb-4";
const SHEET_FOOT = "flex shrink-0 items-center gap-3 border-t border-hairline px-4 pt-3 pb-safe";

function BottomSheet(props: SheetProps) {
  const { open, onOpenChange, description, footer, children } = props;
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [closeThreshold, setCloseThreshold] = useState(0.25);
  const brandProps = useBrandProps();

  // Vaul's threshold is a share of the sheet height; keep it at a fixed 90 px drag.
  useEffect(() => {
    if (!content) return;
    const observer = new ResizeObserver(() => {
      const height = Math.min(content.offsetHeight, window.innerHeight);
      if (height > 0) setCloseThreshold(Math.min(1, DRAG_CLOSE_PX / height));
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [content]);

  const returnFocus = useReturnFocus(open);

  return (
    // autoFocus: vaul leaves focus outside the sheet by default while hiding the page from screen readers.
    <Drawer.Root open={open} onOpenChange={onOpenChange} closeThreshold={closeThreshold} autoFocus>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Drawer.Content
          ref={setContent}
          onCloseAutoFocus={returnFocus}
          onEscapeKeyDown={keepEscForDialog}
          {...brandProps}
          {...(description ? {} : { "aria-describedby": undefined })}
          className={`fixed inset-x-0 bottom-0 z-50 ${SHEET_BOX}`}
        >
          {/* With a stepper, a hairline closes the header so the bar never sits on the body's first photo. */}
          <div className={cn(SHEET_HEAD, props.progress && "border-b border-hairline pb-3")}>
            <span aria-hidden className={SHEET_GRIP} />
            <Header {...props} parts={{ Title: Drawer.Title, Description: Drawer.Description, Close: Drawer.Close }} className="min-h-11" />
          </div>
          <div className={SHEET_BODY}>{children}</div>
          {footer && <div className={SHEET_FOOT}>{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function Panel(props: SheetProps) {
  const { open, onOpenChange, description, footer, children } = props;
  const brandProps = useBrandProps();
  const returnFocus = useReturnFocus(open);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        <Dialog.Content
          onCloseAutoFocus={returnFocus}
          onEscapeKeyDown={keepEscForDialog}
          {...(description ? {} : { "aria-describedby": undefined })}
          {...brandProps}
          className="fixed inset-y-0 right-0 z-50 flex w-[520px] max-w-full flex-col bg-surface shadow-panel outline-none data-[state=closed]:animate-panel-out data-[state=open]:animate-panel-in"
        >
          <Header
            {...props}
            parts={{ Title: Dialog.Title, Description: Dialog.Description, Close: Dialog.Close }}
            large
            className="border-b border-hairline px-6 pt-4.5 pb-3.5"
          />
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex shrink-0 items-center gap-4 border-t border-hairline px-6 pt-4 pb-5">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const PictureClose = ({ children }: { children?: ReactNode }) => <>{children}</>;
const PictureDescription = ({ className, children }: { className?: string; children?: ReactNode }) => <p className={className}>{children}</p>;
/** The still sheet's parts per title element, built once so React keeps the same component types. */
const PICTURE_PARTS: Record<"h2" | "p", Parts> = {
  h2: { Title: ({ className, children }) => <h2 className={className}>{children}</h2>, Description: PictureDescription, Close: PictureClose },
  p: { Title: ({ className, children }) => <p className={className}>{children}</p>, Description: PictureDescription, Close: PictureClose },
};

/**
 * A still picture of the bottom sheet, for the landing's phone mocks: the same header, body and footer, drawn in
 * place (no portal, no scrim, no behaviour). Position it with `className`, e.g. "absolute inset-x-0 bottom-0".
 */
export function SheetPicture({
  title,
  closeLabel,
  eyebrow,
  description,
  footer,
  children,
  as = "h2",
  className,
}: Pick<SheetProps, "title" | "closeLabel" | "eyebrow" | "description" | "footer" | "children"> & { as?: "h2" | "p"; className?: string }) {
  const parts = PICTURE_PARTS[as];
  return (
    <div className={cn(SHEET_BOX, className)}>
      <div className={SHEET_HEAD}>
        <span aria-hidden className={SHEET_GRIP} />
        <Header title={title} closeLabel={closeLabel} eyebrow={eyebrow} description={description} parts={parts} className="min-h-11" />
      </div>
      <div className={SHEET_BODY}>{children}</div>
      {footer && <div className={SHEET_FOOT}>{footer}</div>}
    </div>
  );
}
