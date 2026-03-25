/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        whatsapp: '#25D366',
        accent:   '#10B981',
        primary:  '#06b6d4',
        gold:     '#f59e0b',
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'soft-green': '0 10px 30px rgba(16,185,129,0.06)',
      },
    },
  },
  plugins: [],
};
