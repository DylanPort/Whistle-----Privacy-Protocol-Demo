/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'whistle-accent': '#22c55e',
        'whistle-bg': '#0a0a0a',
        'whistle-border': 'rgba(255, 255, 255, 0.1)',
        'whistle-muted': '#6b7280',
      },
    },
  },
  plugins: [],
}
