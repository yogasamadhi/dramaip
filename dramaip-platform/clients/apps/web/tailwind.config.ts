import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f6f7fb',
          500: '#3454d1',
          700: '#22399b',
        },
      },
    },
  },
  plugins: [],
}

export default config
