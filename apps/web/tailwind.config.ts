import type { Config } from 'tailwindcss';
import forms from '@tailwindcss/forms';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        display: ['"Geist"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Geist"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        'display-2xl': ['clamp(3rem, 6vw, 5.5rem)', { lineHeight: '0.95', letterSpacing: '-0.04em' }],
        'display-xl': ['clamp(2.25rem, 3.8vw, 3.5rem)', { lineHeight: '1', letterSpacing: '-0.035em' }],
        'display-lg': ['2rem', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
        'display-md': ['1.5rem', { lineHeight: '1.15', letterSpacing: '-0.025em' }],
        kicker: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.04em' }],
      },
      // Every semantic color points at a CSS variable redefined under :root
      // (light) and .dark (dark). That way the same Tailwind class flips
      // between modes without duplicating rules.
      colors: {
        canvas: {
          DEFAULT: 'rgb(var(--canvas) / <alpha-value>)',
          raised: 'rgb(var(--canvas-raised) / <alpha-value>)',
          sunken: 'rgb(var(--canvas-sunken) / <alpha-value>)',
        },
        surface: {
          1: 'rgb(var(--surface-1) / <alpha-value>)',
          2: 'rgb(var(--surface-2) / <alpha-value>)',
          3: 'rgb(var(--surface-3) / <alpha-value>)',
        },
        hairline: {
          // Alpha baked in so `border-hairline` stays a faint line in both
          // themes without needing `/10` suffixes everywhere.
          DEFAULT: 'rgb(var(--hairline) / 0.1)',
          strong: 'rgb(var(--hairline) / 0.22)',
        },
        // Context-aware translucent tint: white in dark mode, near-black in
        // light mode. Use with alpha: `bg-sheen/[0.03]`, `bg-sheen/[0.06]`, etc.
        sheen: {
          DEFAULT: 'rgb(var(--sheen) / <alpha-value>)',
        },
        fg: {
          DEFAULT: 'rgb(var(--fg) / <alpha-value>)',
          2: 'rgb(var(--fg-2) / <alpha-value>)',
          3: 'rgb(var(--fg-3) / <alpha-value>)',
          4: 'rgb(var(--fg-4) / <alpha-value>)',
        },
        // Accent — orange (Renoise-ish). Was violet.
        violet: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          bright: 'rgb(var(--accent-bright) / <alpha-value>)',
          soft: 'rgb(var(--accent) / 0.12)',
          ring: 'rgb(var(--accent) / 0.35)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          bright: 'rgb(var(--accent-bright) / <alpha-value>)',
          soft: 'rgb(var(--accent) / 0.12)',
        },
        ok: {
          DEFAULT: 'rgb(var(--ok) / <alpha-value>)',
          soft: 'rgb(var(--ok) / 0.12)',
        },
        warn: {
          DEFAULT: 'rgb(var(--warn) / <alpha-value>)',
          soft: 'rgb(var(--warn) / 0.12)',
        },
        err: {
          DEFAULT: 'rgb(var(--err) / <alpha-value>)',
          soft: 'rgb(var(--err) / 0.12)',
        },
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        DEFAULT: '10px',
        md: '12px',
        lg: '16px',
        xl: '22px',
        '2xl': '28px',
        '3xl': '36px',
      },
      boxShadow: {
        'glass-sm': '0 1px 0 0 rgb(var(--sheen) / 0.04) inset, 0 4px 12px -6px rgba(0,0,0,0.5)',
        glass:
          '0 1px 0 0 rgb(var(--sheen) / 0.05) inset, 0 12px 32px -12px rgba(0,0,0,0.6), 0 0 0 1px rgb(var(--sheen) / 0.04)',
        'glass-lg':
          '0 1px 0 0 rgb(var(--sheen) / 0.06) inset, 0 32px 64px -24px rgba(0,0,0,0.7), 0 0 0 1px rgb(var(--sheen) / 0.05)',
        glow: '0 0 24px -4px rgb(var(--accent) / 0.5), 0 0 1px 0 rgb(var(--accent) / 0.8)',
        'glow-sm': '0 0 10px -2px rgb(var(--accent) / 0.35)',
      },
      backdropBlur: { xs: '4px' },
      keyframes: {
        breath: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.55', transform: 'scale(0.85)' },
        },
        'float-in': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'sheet-in': {
          '0%': { transform: 'translateX(20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
      animation: {
        breath: 'breath 2.2s ease-in-out infinite',
        'float-in': 'float-in 420ms cubic-bezier(0.2, 0.7, 0.2, 1) both',
        'sheet-in': 'sheet-in 360ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
      },
    },
  },
  plugins: [forms],
};

export default config;
