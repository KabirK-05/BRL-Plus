import { Box, BoxProps } from '@chakra-ui/react'

export type GlassCardProps = BoxProps & {
  strength?: 'soft' | 'strong'
}

export function GlassCard({ strength = 'soft', ...props }: GlassCardProps) {
  const bg = strength === 'strong' ? 'glass.bgStrong' : 'glass.bg'
  const borderColor = strength === 'strong' ? 'glass.borderStrong' : 'glass.border'
  const shadow = strength === 'strong' ? 'glass.shadow' : 'glass.shadowTight'

  return (
    <Box
      position="relative"
      overflow="hidden"
      bg={bg}
      borderWidth="1px"
      borderColor={borderColor}
      borderRadius="card"
      boxShadow={shadow}
      _before={{
        content: '""',
        position: 'absolute',
        inset: 0,
        // bgGradient: 'linear(to-br, rgba(255,255,255,0.55), rgba(255,255,255,0.10))',
        opacity: strength === 'strong' ? 0.55 : 0.45,
        pointerEvents: 'none',
      }}
      _after={{
        content: '""',
        position: 'absolute',
        inset: 0,
        // bgGradient: 'radial(rgba(124,58,237,0.14) 0%, rgba(124,58,237,0) 62%)',
        transform: 'translate(20%, -18%)',
        opacity: strength === 'strong' ? 0.7 : 0.55,
        pointerEvents: 'none',
      }}
      sx={{
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
      {...props}
    />
  )
}


