import { extendTheme, ThemeConfig } from '@chakra-ui/react'

const config: ThemeConfig = {
  initialColorMode: 'light',
  useSystemColorMode: false,
}

const fonts = {
  heading: 'var(--font-inter), ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
  body: 'var(--font-inter), ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
  mono: `'Menlo', ui-monospace, SFMono-Regular, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`,
}

const breakpoints = {
  sm: '40em',
  md: '52em',
  lg: '64em',
  xl: '80em',
}

const theme = extendTheme({
  config,
  styles: {
    global: {
      body: {
        bg: 'transparent',
        color: 'app.text',
        fontWeight: 300,
      },
      /**
       * Hide scrollbars globally (keep scrolling behavior).
       * - WebKit (Chromium/Electron/Safari): ::-webkit-scrollbar
       * - Firefox: scrollbar-width
       * - Legacy Edge/IE: -ms-overflow-style
       */
      '*': {
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      },
      '*::-webkit-scrollbar': {
        width: '0px',
        height: '0px',
      },
      '*::-webkit-scrollbar-thumb': {
        background: 'transparent',
      },
      '*::-webkit-scrollbar-track': {
        background: 'transparent',
      },
      // Ensure form fields never show a visible border/outline (theme-level escape hatch).
      'input, textarea': {
        border: '0 !important',
        outline: 'none !important',
      },
      '.chakra-input, .chakra-textarea': {
        border: '0 !important',
        outline: 'none !important',
      },
    },
  },
  semanticTokens: {
    colors: {
      'app.bg': { default: '#F7F6FB' },
      'app.surface': { default: '#FFFFFF' },
      'app.border': { default: '#E5E7EB' },
      'app.text': { default: '#0B1220' },
      'app.muted': { default: '#64748B' },
      'app.accent': { default: '#16A34A' },
      'app.accentSoft': { default: '#DCFCE7' },
      'app.warning': { default: '#F59E0B' },
      'app.danger': { default: '#EF4444' },

      // Background gradients (glassmorphism-style)
      // Grayscale background (professional, neutral)
      'app.bgGradientStart': { default: '#FFFFFF' },
      'app.bgGradientMid': { default: '#F6F7FA' },
      'app.bgGradientEnd': { default: '#EEF1F6' },

      // Glass surface tokens
      'glass.bg': { default: 'rgba(255, 255, 255, 0.55)' },
      'glass.bgStrong': { default: 'rgba(255, 255, 255, 0.72)' },
      'glass.border': { default: 'rgba(15, 23, 42, 0.10)' },
      'glass.borderStrong': { default: 'rgba(15, 23, 42, 0.16)' },
      'glass.shadow': { default: '0 26px 70px rgba(2, 6, 23, 0.16)' },
      'glass.shadowTight': { default: '0 14px 36px rgba(2, 6, 23, 0.14)' },
      'glass.ink': { default: 'rgba(17, 24, 39, 0.92)' },
      'glass.mutedInk': { default: 'rgba(15, 23, 42, 0.64)' },
    },
    radii: {
      card: '16px',
      pill: '9999px',
    },
    shadows: {
      card: '0 26px 70px rgba(2, 6, 23, 0.16)',
    },
  },
  components: {
    Button: {
      baseStyle: {
        borderRadius: '12px',
        fontWeight: 500,
      },
      variants: {
        solid: {
          bgGradient: 'linear(to-r, #7C3AED 0%, #A855F7 55%, #EC4899 110%)',
          color: 'white',
          boxShadow: '0 14px 34px rgba(124, 58, 237, 0.30)',
          _hover: {
            bgGradient: 'linear(to-r, #6D28D9 0%, #9333EA 55%, #DB2777 110%)',
            transform: 'translateY(-1px)',
            boxShadow: '0 18px 44px rgba(124, 58, 237, 0.34)',
          },
          _active: {
            transform: 'translateY(0px)',
            boxShadow: '0 10px 24px rgba(124, 58, 237, 0.26)',
          },
        },
        outline: {
          bg: 'glass.bg',
          borderColor: 'glass.border',
          borderWidth: '1px',
          color: 'glass.ink',
          _hover: { bg: 'rgba(255, 255, 255, 0.70)' },
          _active: { bg: 'rgba(255, 255, 255, 0.78)' },
        },
        ghost: {
          color: 'glass.ink',
          _hover: { bg: 'rgba(15, 23, 42, 0.06)' },
          _active: { bg: 'rgba(15, 23, 42, 0.10)' },
        },
      },
    },
    Badge: {
      baseStyle: {
        fontWeight: 500,
        letterSpacing: '0.01em',
      },
    },
    Input: {
      baseStyle: {
        field: {
          borderRadius: '12px',
          bg: 'glass.bgStrong',
          borderWidth: '0px',
          borderColor: 'transparent',
          _hover: { borderColor: 'transparent' },
          _focusVisible: { borderColor: 'transparent', boxShadow: '0 0 0 3px rgba(17, 24, 39, 0.08)' },
        },
      },
    },
    Textarea: {
      baseStyle: {
        borderRadius: '12px',
        bg: 'glass.bgStrong',
        borderWidth: '0px',
        borderColor: 'transparent',
        border: '0px',
        outline: 'none',
        _hover: { borderColor: 'transparent' },
        _focusVisible: { borderColor: 'transparent', boxShadow: '0 0 0 3px rgba(17, 24, 39, 0.08)' },
      },
    },
    Tabs: {
      variants: {
        'soft-rounded': {
          tab: {
            borderRadius: '12px',
            bg: 'rgba(255, 255, 255, 0.40)',
            borderWidth: '1px',
            borderColor: 'glass.border',
            color: 'glass.ink',
            fontWeight: 500,
            _selected: {
              bg: 'glass.ink',
              color: 'white',
              borderColor: 'rgba(17, 24, 39, 0.28)',
              boxShadow: '0 10px 22px rgba(2, 6, 23, 0.16)',
            },
          },
        },
      },
    },
  },
  fonts,
  breakpoints,
})

export default theme
