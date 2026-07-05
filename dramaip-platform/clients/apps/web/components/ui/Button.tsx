import type { ButtonHTMLAttributes } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
}

export function Button({ className = '', variant = 'primary', ...props }: ButtonProps) {
  const variantClass =
    variant === 'primary'
      ? 'bg-brand-500 text-white hover:bg-brand-700'
      : 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50'

  return (
    <button
      className={`inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition ${variantClass} ${className}`}
      {...props}
    />
  )
}
