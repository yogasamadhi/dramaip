import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { AlertCircle, Inbox, LoaderCircle, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "./cn";
import { Button, IconButton } from "./primitives";

const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[70] bg-overlay/65 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "Dialog.Overlay";

const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    closeLabel?: string;
    hideClose?: boolean;
  }
>(({ className, children, closeLabel = "关闭", hideClose, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-3rem)] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-line bg-surface-raised p-6 text-ink shadow-float outline-none",
        className,
      )}
      {...props}
    >
      {children}
      {!hideClose ? (
        <DialogPrimitive.Close asChild>
          <IconButton
            aria-label={closeLabel}
            variant="ghost"
            size="sm"
            className="absolute right-3 top-3"
          >
            <X aria-hidden="true" className="size-4" />
          </IconButton>
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "Dialog.Content";

const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "pr-10 text-lg font-semibold tracking-tight text-ink",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = "Dialog.Title";

const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("mt-1.5 text-sm leading-6 text-muted", className)}
    {...props}
  />
));
DialogDescription.displayName = "Dialog.Description";

// Radix Root is shared by Dialog and Drawer. Do not attach both sets of
// statics to it: the second Object.assign would overwrite the first Content.
const DialogRoot = (
  props: ComponentPropsWithoutRef<typeof DialogPrimitive.Root>,
) => <DialogPrimitive.Root {...props} />;

export const Dialog = Object.assign(DialogRoot, {
  Trigger: DialogPrimitive.Trigger,
  Close: DialogPrimitive.Close,
  Title: DialogTitle,
  Description: DialogDescription,
  Content: DialogContent,
});

export type ConfirmDialogOptions = {
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type ConfirmRequest = ConfirmDialogOptions & {
  resolve(value: boolean): void;
};

let presentConfirmDialog: ((request: ConfirmRequest) => void) | undefined;

export function confirmDialog(
  value: string | ConfirmDialogOptions,
): Promise<boolean> {
  const options: ConfirmDialogOptions =
    typeof value === "string" ? { description: value } : value;
  if (!presentConfirmDialog) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    presentConfirmDialog?.({ ...options, resolve });
  });
}

export function ConfirmProvider(props: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest>();

  useEffect(() => {
    presentConfirmDialog = (next) =>
      setRequest((current) => {
        current?.resolve(false);
        return next;
      });
    return () => {
      presentConfirmDialog = undefined;
    };
  }, []);

  const destructive =
    request?.tone === "danger" ||
    /删除|撤销|替换|放弃|回收站|否决/.test(request?.description ?? "");
  const finish = (accepted: boolean): void => {
    request?.resolve(accepted);
    setRequest(undefined);
  };

  return (
    <>
      {props.children}
      <Dialog
        open={Boolean(request)}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <Dialog.Content aria-label="操作确认" className="max-w-md" hideClose>
          <Dialog.Title>
            {request?.title ?? (destructive ? "确认危险操作" : "确认操作")}
          </Dialog.Title>
          <Dialog.Description>{request?.description}</Dialog.Description>
          <DialogFooter>
            <Button variant="ghost" onClick={() => finish(false)}>
              {request?.cancelLabel ?? "取消"}
            </Button>
            <Button
              variant={destructive ? "danger" : "primary"}
              onClick={() => finish(true)}
            >
              {request?.confirmLabel ?? (destructive ? "确认继续" : "确认")}
            </Button>
          </DialogFooter>
        </Dialog.Content>
      </Dialog>
    </>
  );
}

export type ToastOptions = {
  message: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  actionLabel?: string;
  onAction?(): void | Promise<void>;
  durationMs?: number;
};

type ToastEntry = ToastOptions & { id: number };

let presentToast: ((toast: ToastOptions) => void) | undefined;
let nextToastId = 1;

/**
 * Shows a transient status message, optionally with one recovery action such
 * as "撤销". Used for reversible operations instead of a blocking confirm.
 */
export function showToast(toast: ToastOptions): void {
  presentToast?.(toast);
}

export function ToastProvider(props: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  useEffect(() => {
    presentToast = (toast) => {
      const id = nextToastId++;
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      window.setTimeout(
        () => setToasts((current) => current.filter((t) => t.id !== id)),
        toast.durationMs ?? 6000,
      );
    };
    return () => {
      presentToast = undefined;
    };
  }, []);

  const dismiss = (id: number): void =>
    setToasts((current) => current.filter((t) => t.id !== id));

  return (
    <>
      {props.children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-1/2 z-[90] grid w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto flex items-center gap-3 rounded-lg border bg-surface-raised px-4 py-3 text-sm text-ink shadow-float",
              toast.tone === "success" && "border-success/30",
              toast.tone === "warning" && "border-warning/30",
              toast.tone === "danger" && "border-danger/30",
              (!toast.tone || toast.tone === "neutral") && "border-line",
            )}
          >
            <div className="min-w-0 flex-1">{toast.message}</div>
            {toast.actionLabel && toast.onAction ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  dismiss(toast.id);
                  void toast.onAction?.();
                }}
              >
                {toast.actionLabel}
              </Button>
            ) : null}
            <IconButton
              size="sm"
              variant="ghost"
              aria-label="关闭提示"
              onClick={() => dismiss(toast.id)}
            >
              <X aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        ))}
      </div>
    </>
  );
}

const DrawerContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: "left" | "right";
    closeLabel?: string;
  }
>(
  (
    { className, children, side = "right", closeLabel = "关闭抽屉", ...props },
    ref,
  ) => (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-y-0 z-[71] flex w-[min(520px,calc(100vw-1rem))] flex-col overflow-auto border-line bg-surface-raised p-5 text-ink shadow-float outline-none",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close asChild>
          <IconButton
            aria-label={closeLabel}
            variant="ghost"
            size="sm"
            className="absolute right-3 top-3"
          >
            <X aria-hidden="true" className="size-4" />
          </IconButton>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
);
DrawerContent.displayName = "Drawer.Content";

const DrawerRoot = (
  props: ComponentPropsWithoutRef<typeof DialogPrimitive.Root>,
) => <DialogPrimitive.Root {...props} />;

export const Drawer = Object.assign(DrawerRoot, {
  Trigger: DialogPrimitive.Trigger,
  Close: DialogPrimitive.Close,
  Title: DialogTitle,
  Description: DialogDescription,
  Content: DrawerContent,
});

const DropdownContent = forwardRef<
  ElementRef<typeof DropdownPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.Content>
>(({ className, sideOffset = 7, ...props }, ref) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "ui-popover z-[80] min-w-48 rounded-lg border border-line bg-surface-raised p-1.5 text-ink shadow-float outline-none",
        className,
      )}
      {...props}
    />
  </DropdownPrimitive.Portal>
));
DropdownContent.displayName = "DropdownMenu.Content";

const DropdownItem = forwardRef<
  ElementRef<typeof DropdownPrimitive.Item>,
  ComponentPropsWithoutRef<typeof DropdownPrimitive.Item>
>(({ className, ...props }, ref) => (
  <DropdownPrimitive.Item
    ref={ref}
    className={cn(
      "no-drag flex min-h-9 cursor-default select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-surface-muted data-[highlighted]:text-ink",
      className,
    )}
    {...props}
  />
));
DropdownItem.displayName = "DropdownMenu.Item";

export const DropdownMenu = Object.assign(DropdownPrimitive.Root, {
  Trigger: DropdownPrimitive.Trigger,
  Content: DropdownContent,
  Item: DropdownItem,
  Label: DropdownPrimitive.Label,
  Separator: DropdownPrimitive.Separator,
  RadioGroup: DropdownPrimitive.RadioGroup,
  RadioItem: DropdownPrimitive.RadioItem,
  ItemIndicator: DropdownPrimitive.ItemIndicator,
});

export const ScrollArea = forwardRef<
  ElementRef<typeof ScrollAreaPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="size-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollAreaPrimitive.Scrollbar
      orientation="vertical"
      className="flex w-2.5 touch-none select-none p-0.5"
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-line-strong" />
    </ScrollAreaPrimitive.Scrollbar>
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = "ScrollArea";

export function EmptyState(props: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-h-52 place-items-center rounded-xl border border-dashed border-line-strong bg-surface-muted/40 px-6 py-10 text-center",
        props.className,
      )}
    >
      <div className="max-w-sm">
        <div className="mx-auto mb-3 grid size-10 place-items-center rounded-lg bg-surface text-muted shadow-control">
          {props.icon ?? <Inbox aria-hidden="true" className="size-5" />}
        </div>
        <h3 className="font-semibold text-ink">{props.title}</h3>
        {props.description ? (
          <p className="mt-1.5 text-sm leading-6 text-muted">
            {props.description}
          </p>
        ) : null}
        {props.action ? (
          <div className="mt-4 flex justify-center">{props.action}</div>
        ) : null}
      </div>
    </div>
  );
}

export function LoadingState(props: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-40 items-center justify-center gap-2 text-sm text-muted",
        props.className,
      )}
      role="status"
    >
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      {props.label ?? "正在加载…"}
    </div>
  );
}

export function InlineNotice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-lg border px-4 py-3 text-sm leading-6",
        tone === "info" && "border-info/25 bg-info-soft text-info-strong",
        tone === "success" &&
          "border-success/25 bg-success-soft text-success-strong",
        tone === "warning" &&
          "border-warning/25 bg-warning-soft text-warning-strong",
        tone === "danger" &&
          "border-danger/25 bg-danger-soft text-danger-strong",
        className,
      )}
    >
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>
        {title ? <p className="font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function DialogFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-6 flex flex-wrap justify-end gap-2", className)}
      {...props}
    />
  );
}
