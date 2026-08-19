/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#4A90D9',
          hover: '#3A7BC8',
        },
      },
    },
  },
  plugins: [],
};
