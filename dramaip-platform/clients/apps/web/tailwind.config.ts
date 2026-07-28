import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff8f2',
          500: '#c85532',
          700: '#96391f',
        },
        ink: '#20201f',
        rust: '#b94727',
        sand: '#eadbc8',
      },
      boxShadow: {
        studio: '0 24px 70px -30px rgba(61, 42, 30, .32)',
      },
    },
  },
  plugins: [],
}

export default config
