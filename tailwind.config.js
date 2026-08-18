/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe6ff',
          200: '#bccfff',
          300: '#8eacff',
          400: '#5b82ff',
          500: '#3b62ff',
          600: '#2342f5',
          700: '#1c33d8',
          800: '#1d2eae',
          900: '#1e2d87',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'SF Pro Text', 'Helvetica Neue', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
