import { ChakraProvider } from '@chakra-ui/react'
import { Inter } from 'next/font/google'

import theme from '../lib/theme'
import { AppProps } from 'next/app'

const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-inter',
})

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ChakraProvider theme={theme}>
      <div className={inter.className}>
        <Component {...pageProps} />
      </div>
    </ChakraProvider>
  )
}

export default MyApp
