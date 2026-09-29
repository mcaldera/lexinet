import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Bundled in main.tsx (@fontsource): UI, Roman capitals for titles, a book face for
      // Latin, and a reading serif for Italian (headwords, example sentences): Cormorant
      // set Italian graves steep and off to the side (così, più), Newsreader doesn't.
      fontFamily: {
        sans: ['"Inter Variable"', ...defaultTheme.fontFamily.sans],
        serif: ['"Newsreader Variable"', 'Georgia', 'serif'],
        title: ['"Cinzel Variable"', 'Georgia', 'serif'],
        latin: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
