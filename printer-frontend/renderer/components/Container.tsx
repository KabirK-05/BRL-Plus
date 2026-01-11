import { Flex, FlexProps } from '@chakra-ui/react'

export const Container = (props: FlexProps) => (
  <Flex
    direction="column"
    alignItems="stretch"
    justifyContent="flex-start"
    bg="app.bg"
    color="app.text"
    transition="all 0.15s ease-out"
    {...props}
  />
)
