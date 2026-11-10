// Dialog: modal dialog and side drawer built on the Radix Dialog primitive.
// Both portal above the page on the overlay layer, trap focus, close on
// Escape and restore focus to the trigger.

import {
  forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes, type ReactNode,
} from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import clsx from 'clsx'
import { IconButton } from './Button.tsx'
import { useControlLabels } from './ControlLabels.tsx'
import { IconCloseOutlineRegular } from './icons/index.tsx'
import css from './Dialog.module.css'

type ContentProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Content>

function CloseButton({ label }: { label: string }) {
  return (
    <DialogPrimitive.Close asChild>
      <IconButton aria-label={label} variant="ghost" size="sm" className={css.close}>
        <IconCloseOutlineRegular />
      </IconButton>
    </DialogPrimitive.Close>
  )
}

const DialogContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, ContentProps & {
  /** Accessible name of the close button; defaults to the provided `close` label. */
  closeLabel?: string
  /** Leave out the close button, e.g. when the footer carries the only exits. */
  hideClose?: boolean
}>(function DialogContent({ className, children, closeLabel, hideClose, ...props }, ref) {
  const labels = useControlLabels()
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={css.overlay} />
      <DialogPrimitive.Content ref={ref} className={clsx(css.dialog, className)} {...props}>
        {children}
        {hideClose ? null : <CloseButton label={closeLabel ?? labels.close} />}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})

const DialogTitle = forwardRef<ElementRef<typeof DialogPrimitive.Title>, ComponentPropsWithoutRef<typeof DialogPrimitive.Title>>(
  function DialogTitle({ className, ...props }, ref) {
    return <DialogPrimitive.Title ref={ref} className={clsx(css.title, className)} {...props} />
  },
)

const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={clsx(css.description, className)} {...props} />
})

/** Modal dialog root with Trigger, Close, Title, Description and Content parts. */
export const Dialog = Object.assign((props: ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) => <DialogPrimitive.Root {...props} />, {
  Trigger: DialogPrimitive.Trigger,
  Close: DialogPrimitive.Close,
  Title: DialogTitle,
  Description: DialogDescription,
  Content: DialogContent,
})

const DrawerContent = forwardRef<ElementRef<typeof DialogPrimitive.Content>, ContentProps & {
  /** Edge the drawer slides in from. */
  side?: 'left' | 'right'
  /** Accessible name of the close button; defaults to the provided `closeDrawer` label. */
  closeLabel?: string
}>(function DrawerContent({ className, children, side = 'right', closeLabel, ...props }, ref) {
  const labels = useControlLabels()
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={css.overlay} />
      <DialogPrimitive.Content ref={ref} data-side={side} className={clsx(css.drawer, className)} {...props}>
        {children}
        <CloseButton label={closeLabel ?? labels.closeDrawer} />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})

/** Side drawer root: the Dialog parts with an edge-anchored Content. */
export const Drawer = Object.assign((props: ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) => <DialogPrimitive.Root {...props} />, {
  Trigger: DialogPrimitive.Trigger,
  Close: DialogPrimitive.Close,
  Title: DialogTitle,
  Description: DialogDescription,
  Content: DrawerContent,
})

/** Render the dialog's trailing action row. */
export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  return <div className={clsx(css.footer, className)} {...props} />
}
