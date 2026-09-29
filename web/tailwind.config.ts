import type { Config } from 'tailwindcss';

/**
 * La paleta sale del propio juego, no de un tema genérico: el mismo oro sobre
 * el mismo azul casi negro. Una web que no se parece al juego que descarga
 * hace dudar de si es la web oficial.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#05060e',
          900: '#080a1a',
          800: '#0d1024',
          700: '#141833',
          600: '#1d2246',
        },
        gold: {
          300: '#ffe08f',
          400: '#ffd166',
          500: '#f0b429',
          600: '#c98a10',
          700: '#8a5c07',
        },
        felt: {
          500: '#0f7a4a',
          600: '#0a5c37',
        },
        ruby: {
          500: '#e02b4d',
        },
      },
      /*
       * Tailwind solo trae unos pocos escalones de opacidad (5, 10, 20, 25…) y
       * los bordes de este diseño viven entre el 8 % y el 20 %, donde esos
       * saltos se notan. Añadir los intermedios es más barato que redondear
       * cada borde al escalón más cercano.
       */
      opacity: {
        8: '0.08',
        12: '0.12',
        15: '0.15',
        18: '0.18',
        22: '0.22',
        35: '0.35',
        42: '0.42',
        45: '0.45',
        55: '0.55',
        62: '0.62',
        65: '0.65',
        78: '0.78',
        85: '0.85',
      },
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 40px -10px rgba(240, 180, 41, 0.45)',
        'glow-lg': '0 0 90px -20px rgba(240, 180, 41, 0.55)',
        card: '0 18px 50px -25px rgba(0, 0, 0, 0.9)',
      },
      backgroundImage: {
        'felt-radial':
          'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(240,180,41,0.16), transparent 60%)',
        'gold-sheen':
          'linear-gradient(110deg, #8a5c07 0%, #f0b429 35%, #ffe08f 50%, #f0b429 65%, #8a5c07 100%)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'sheen': {
          '0%': { backgroundPosition: '200% center' },
          '100%': { backgroundPosition: '-200% center' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        'sheen': 'sheen 6s linear infinite',
        'pulse-soft': 'pulse-soft 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
