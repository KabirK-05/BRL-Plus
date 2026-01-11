import { Box, BoxProps } from '@chakra-ui/react'
import dynamic from 'next/dynamic'

// JSON file name includes a space; importing is fine with resolveJsonModule enabled.
import animationData from './Lottie Printer.json'

const Lottie = dynamic(async () => (await import('lottie-react')).default, { ssr: false })

export type LottiePrinterProps = BoxProps

export function LottiePrinter(props: LottiePrinterProps) {
  return (
    <Box
      w={{ base: '110px', md: '120px' }}
      h={{ base: '120px', md: '120px' }}
      display="flex"
      alignItems="center"
      justifyContent="center"
      {...props}
    >
      <Box w="100%" h="100%">
        <Lottie
          animationData={animationData as unknown as object}
          loop
          autoplay
          rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
          style={{ width: '100%', height: '100%' }}
        />
      </Box>
    </Box>
  )
}


