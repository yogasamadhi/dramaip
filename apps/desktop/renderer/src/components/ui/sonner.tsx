import type { ComponentProps } from 'react'
import { Toaster as Sonner } from 'sonner'
import { useTheme } from '@/components/ThemeProvider'

type ToasterProps = ComponentProps<typeof Sonner>

const Toaster = ({ theme: themeProp, ...props }: ToasterProps) => {
  const { theme } = useTheme()

  return (
    <Sonner
      theme={themeProp ?? theme}
      position="bottom-right"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
