import * as LabelPrimitive from "@radix-ui/react-label";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as SlotPrimitive from "@radix-ui/react-slot";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

const buttonVariants = cva(
  "ui-button no-drag inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border text-[15px] font-medium leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary:
          "border-action bg-action text-action-contrast shadow-control hover:bg-action-hover",
        secondary:
          "border-line-strong bg-surface text-ink shadow-control hover:bg-surface-raised",
        ghost:
          "border-transparent bg-transparent text-muted hover:bg-surface-muted hover:text-ink",
        subtle:
          "border-transparent bg-brand-soft text-brand-strong hover:bg-brand-soft-hover",
        danger:
          "border-danger bg-danger text-white shadow-control hover:bg-danger-strong",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4",
        lg: "h-11 px-5 text-base",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild,
      className,
      loading,
      disabled,
      children,
      variant,
      size,
      ...props
    },
    ref,
  ) => {
    const classes = cn(buttonVariants({ variant, size }), className);
    if (asChild)
      return (
        <SlotPrimitive.Slot ref={ref} className={classes} {...props}>
          {children}
        </SlotPrimitive.Slot>
      );
    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

/**
 * Migration-safe control for specialized canvas, timeline and dense editor
 * actions. It centralizes focus, disabled and title-bar interaction without
 * imposing standard button dimensions on domain-specific controls.
 */
export const BareButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "no-drag transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-45",
      className,
    )}
    {...props}
  />
));
BareButton.displayName = "BareButton";

export type IconButtonProps = Omit<ButtonProps, "aria-label" | "size"> & {
  "aria-label": string;
  size?: "sm" | "md" | "lg";
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, title, ...props }, ref) => (
    <Button
      ref={ref}
      title={title ?? props["aria-label"]}
      className={cn(
        "shrink-0 px-0",
        props.size === "sm" && "w-8",
        (!props.size || props.size === "md") && "w-10",
        props.size === "lg" && "w-11",
        className,
      )}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "ui-field h-10 w-full rounded-md border border-line-strong bg-field px-3 text-[15px] text-ink shadow-control outline-none placeholder:text-muted/70 focus:border-focus focus:ring-2 focus:ring-focus/15 disabled:cursor-not-allowed disabled:opacity-55",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "ui-field min-h-28 w-full resize-y rounded-md border border-line-strong bg-field px-3 py-2.5 text-[15px] leading-6 text-ink shadow-control outline-none placeholder:text-muted/70 focus:border-focus focus:ring-2 focus:ring-focus/15 disabled:cursor-not-allowed disabled:opacity-55",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Field(props: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", props.className)}>
      <LabelPrimitive.Root
        htmlFor={props.htmlFor}
        className="text-sm font-medium text-ink"
      >
        {props.label}
        {props.required ? <span className="ml-1 text-danger">*</span> : null}
      </LabelPrimitive.Root>
      {props.children}
      {props.error ? (
        <p className="text-xs leading-5 text-danger">{props.error}</p>
      ) : props.hint ? (
        <p className="text-xs leading-5 text-muted">{props.hint}</p>
      ) : null}
    </div>
  );
}

export type SelectOption = {
  value: string;
  label: ReactNode;
  group?: string;
  disabled?: boolean;
};
export type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children" | "onChange"
> & {
  options: readonly SelectOption[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  onValueChange?(value: string): void;
};

export function Select({
  className,
  options,
  placeholder,
  value,
  defaultValue,
  disabled,
  name,
  required,
  onValueChange,
  ...props
}: SelectProps) {
  const optionGroups = new Map<string | undefined, SelectOption[]>();
  for (const option of options) {
    const group = optionGroups.get(option.group) ?? [];
    group.push(option);
    optionGroups.set(option.group, group);
  }

  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      name={name}
      required={required}
      onValueChange={onValueChange}
    >
      <SelectPrimitive.Trigger
        className={cn(
          "ui-field no-drag flex h-10 w-full items-center justify-between gap-3 rounded-md border border-line-strong bg-field px-3 text-left text-[15px] text-ink shadow-control outline-none data-[placeholder]:text-muted/70 focus:border-focus focus:ring-2 focus:ring-focus/15 disabled:cursor-not-allowed disabled:opacity-55",
          className,
        )}
        aria-label={props["aria-label"]}
        id={props.id}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown aria-hidden="true" className="size-4 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="ui-popover z-[80] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-surface-raised p-1 shadow-float"
        >
          <SelectPrimitive.Viewport className="max-h-80">
            {Array.from(optionGroups.entries()).map(
              ([groupLabel, groupOptions]) => (
                <SelectPrimitive.Group key={groupLabel ?? "__ungrouped__"}>
                  {groupLabel && (
                    <SelectPrimitive.Label className="px-3 pb-1 pt-2 text-xs font-semibold text-muted">
                      {groupLabel}
                    </SelectPrimitive.Label>
                  )}
                  {groupOptions.map((option) => (
                    <SelectPrimitive.Item
                      key={option.value}
                      value={option.value}
                      disabled={option.disabled}
                      className="relative flex min-h-9 cursor-default select-none items-center rounded-md py-2 pl-8 pr-3 text-sm text-ink outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-brand-soft data-[highlighted]:text-brand-strong"
                    >
                      <span className="absolute left-2.5 grid size-4 place-items-center">
                        <SelectPrimitive.ItemIndicator>
                          <Check aria-hidden="true" className="size-4" />
                        </SelectPrimitive.ItemIndicator>
                      </span>
                      <SelectPrimitive.ItemText>
                        {option.label}
                      </SelectPrimitive.ItemText>
                    </SelectPrimitive.Item>
                  ))}
                </SelectPrimitive.Group>
              ),
            )}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

const TabsRoot = TabsPrimitive.Root;
const TabsList = forwardRef<
  ElementRef<typeof TabsPrimitive.List>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex min-h-10 items-center gap-1 rounded-lg bg-surface-muted p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "Tabs.List";
const TabsTrigger = forwardRef<
  ElementRef<typeof TabsPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "no-drag rounded-md px-3 py-2 text-sm font-medium text-muted outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-focus data-[state=active]:bg-surface-raised data-[state=active]:text-ink data-[state=active]:shadow-control",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "Tabs.Trigger";
const TabsContent = forwardRef<
  ElementRef<typeof TabsPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "outline-none focus-visible:ring-2 focus-visible:ring-focus",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "Tabs.Content";

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
});

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <article
      className={cn(
        "rounded-xl border border-line bg-surface p-5 text-ink shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "rounded-xl border border-line bg-surface p-5 text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function Toolbar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="toolbar"
      className={cn(
        "flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/90 p-2 shadow-control backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader(props: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex min-h-20 flex-wrap items-center justify-between gap-4 border-b border-line px-1 pb-4",
        props.className,
      )}
    >
      <div className="max-w-3xl">
        {props.eyebrow ? (
          <p className="text-xs font-semibold tracking-[0.14em] text-brand-strong">
            {props.eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          {props.title}
        </h1>
        {props.description ? (
          <p className="mt-1 text-sm leading-5 text-muted">
            {props.description}
          </p>
        ) : null}
      </div>
      {props.actions ? (
        <div className="flex items-center gap-2">{props.actions}</div>
      ) : null}
    </header>
  );
}

const statusVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "border-line bg-surface-muted text-muted",
        info: "border-info/25 bg-info-soft text-info-strong",
        success: "border-success/25 bg-success-soft text-success-strong",
        warning: "border-warning/25 bg-warning-soft text-warning-strong",
        danger: "border-danger/25 bg-danger-soft text-danger-strong",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function StatusBadge({
  tone,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof statusVariants>) {
  return (
    <span className={cn(statusVariants({ tone }), className)} {...props} />
  );
}
