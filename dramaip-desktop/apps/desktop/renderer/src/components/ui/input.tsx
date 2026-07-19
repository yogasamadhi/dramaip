import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, placeholder, title, 'aria-label': ariaLabel, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-[var(--control-height)] w-full rounded-[var(--radius-sm)] border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
          className,
        )}
        ref={ref}
        placeholder={placeholder}
        title={title}
        aria-label={ariaLabel ?? title ?? placeholder}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
