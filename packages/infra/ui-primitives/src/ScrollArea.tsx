// ScrollArea: a scroll container with theme-styled overlay scrollbars, built
// on the Radix ScrollArea primitive. Content scrolls inside the viewport.

import { forwardRef, type HTMLAttributes } from 'react'
import { ScrollArea as ScrollPrimitive } from 'radix-ui'
import clsx from 'clsx'
import css from './ScrollArea.module.css'

/** Render a scroll container; attributes apply to the outer root. */
export const ScrollArea = forwardRef<HTMLDivElement, Omit<HTMLAttributes<HTMLDivElement>, 'dir'>>(function ScrollArea({
  className, children, ...props
}, ref) {
  return (
    <ScrollPrimitive.Root ref={ref} type="hover" className={clsx(css.root, className)} {...props}>
      <ScrollPrimitive.Viewport className={css.viewport}>{children}</ScrollPrimitive.Viewport>
      <ScrollPrimitive.Scrollbar orientation="vertical" className={css.scrollbar}>
        <ScrollPrimitive.Thumb className={css.thumb} />
      </ScrollPrimitive.Scrollbar>
      <ScrollPrimitive.Scrollbar orientation="horizontal" className={css.scrollbar}>
        <ScrollPrimitive.Thumb className={css.thumb} />
      </ScrollPrimitive.Scrollbar>
      <ScrollPrimitive.Corner />
    </ScrollPrimitive.Root>
  )
})
