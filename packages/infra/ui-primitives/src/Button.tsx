// Button: token-styled button atoms. Variants map to the --dsw-alias-button-*
// fill families through cva; `asChild` merges the styling onto a child element
// through the Radix Slot.

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import clsx from 'clsx'
import { IconLoadingOutlineRegular } from './icons/index.tsx'
import css from './Button.module.css'

const button = cva(css.button, {
  variants: {
    variant: {
      primary: css.primary,
      secondary: css.secondary,
      ghost: css.ghost,
      subtle: css.subtle,
      outline: css.outline,
      toolbar: css.toolbar,
      danger: css.danger,
    },
    size: { sm: css.sm, md: css.md, lg: css.lg },
  },
  defaultVariants: { variant: 'secondary', size: 'md' },
})

/** Visual variant, each backed by its --dsw-alias-* token family. */
export type ButtonVariant = NonNullable<VariantProps<typeof button>['variant']>
/** Control height: 'sm' 28px, 'md' 36px, 'lg' 40px. */
export type ButtonSize = NonNullable<VariantProps<typeof button>['size']>

export type ButtonProps = {
  variant?: ButtonVariant | null | undefined
  size?: ButtonSize | null | undefined
  icon?: ReactNode
  loading?: boolean | undefined
  asChild?: boolean | undefined
  className?: string | undefined
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

/**
 * Render a button.
 * @param props.variant - visual family (default 'secondary').
 * @param props.size - control height (default 'md').
 * @param props.icon - optional leading 16px icon node.
 * @param props.loading - replaces the icon with a spinner and disables the button.
 * @param props.asChild - style the single child element instead of rendering a button.
 * @param ref - native button for focus management and overlay anchors.
 * @returns the button element; native button attributes pass through.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant, size, icon, loading, asChild, className, children, type, disabled, ...rest
}, ref) {
  const classes = clsx(button({ variant, size }), className)
  if (asChild) return <Slot.Root ref={ref} className={classes} {...rest}>{children}</Slot.Root>
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading
        ? <span className={clsx(css.icon, css.spinner)}><IconLoadingOutlineRegular /></span>
        : icon != null && <span className={css.icon}>{icon}</span>}
      {children}
    </button>
  )
})

export type IconButtonProps = Omit<ButtonProps, 'aria-label' | 'icon'> & { 'aria-label': string }

/**
 * Render a square icon-only button; its accessible name doubles as the tooltip.
 * @param props.aria-label - localized accessible name, required.
 * @returns the button element.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  className, title, ...props
}, ref) {
  return <Button ref={ref} title={title ?? props['aria-label']} className={clsx(css.square, className)} {...props} />
})

/**
 * Render an unstyled button for dense, domain-specific controls (canvas,
 * timeline, editor gutters). It keeps the shared focus, disabled and
 * window-drag behavior without imposing control dimensions.
 * @returns the native button; attributes pass through.
 */
export const BareButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function BareButton({
  className, type, ...props
}, ref) {
  return <button ref={ref} type={type ?? 'button'} className={clsx(css.bare, className)} {...props} />
})
