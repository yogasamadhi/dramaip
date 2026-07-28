import type { ButtonHTMLAttributes } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
}

export function Button({ className = '', variant = 'primary', ...props }: ButtonProps) {
  const variantClass =
    variant === 'primary'
      ? 'bg-ink text-white hover:bg-rust'
      : 'border border-stone-300 bg-white text-stone-900 hover:border-stone-500 hover:bg-stone-50'

  return (
    <button
      className={`inline-flex h-10 items-center justify-center rounded-full px-5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rust disabled:cursor-not-allowed disabled:opacity-50 ${variantClass} ${className}`}
      {...props}
    />
  )
}
