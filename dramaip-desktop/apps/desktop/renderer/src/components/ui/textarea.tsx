import * as React from 'react'
import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, placeholder, title, 'aria-label': ariaLabel, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-[var(--radius-sm)] border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
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
Textarea.displayName = 'Textarea'

export { Textarea }
