import { Stack } from 'expo-router'

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'DramaIP' }} />
      <Stack.Screen name="(auth)/login" options={{ title: 'Login' }} />
    </Stack>
  )
}
