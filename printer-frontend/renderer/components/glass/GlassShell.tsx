import { Box, BoxProps } from '@chakra-ui/react'

export function GlassShell(props: BoxProps) {
  return (
    <Box
      minH="100vh"
      position="relative"
      overflow="hidden"
      bgGradient="linear(to-br, app.bgGradientStart 0%, app.bgGradientMid 45%, app.bgGradientEnd 100%)"
      {...props}
    >
      {/* Soft grayscale “blob” highlights (neutral, professional) */}
      <Box
        position="absolute"
        inset="-40%"
        bgGradient="radial(rgba(15,23,42,0.08) 0%, rgba(15,23,42,0) 60%)"
        transform="translate(16%, -6%)"
        pointerEvents="none"
      />
      <Box
        position="absolute"
        inset="-40%"
        bgGradient="radial(rgba(15,23,42,0.06) 0%, rgba(15,23,42,0) 62%)"
        transform="translate(-22%, 18%)"
        pointerEvents="none"
      />
      <Box
        position="absolute"
        inset="-45%"
        bgGradient="radial(rgba(15,23,42,0.05) 0%, rgba(15,23,42,0) 64%)"
        transform="translate(26%, 26%)"
        pointerEvents="none"
      />

      {/* Subtle noise (CSS-only approximation) */}
      <Box
        position="absolute"
        inset={0}
        opacity={0.04}
        backgroundImage="repeating-linear-gradient(0deg, rgba(15,23,42,0.18) 0px, rgba(15,23,42,0.18) 1px, transparent 1px, transparent 3px)"
        pointerEvents="none"
      />

      {/* Content */}
      <Box position="relative">{props.children}</Box>
    </Box>
  )
}


