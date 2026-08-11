import '../global.css'

import { useEffect, useState } from 'react'
import { useColorScheme, View } from 'react-native'
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { FontAwesome } from '@expo/vector-icons'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { Stack } from 'expo-router'
import * as Font from 'expo-font'

import { GluestackUIProvider } from '@/src/components/ui/gluestack-ui-provider'

export { ErrorBoundary } from 'expo-router'

export const unstable_settings = {
  initialRouteName: 'index',
}

SplashScreen.preventAutoHideAsync().catch(() => {
  /* The splash module can throw under Expo Go's web target; ignore it there. */
})

export default function RootLayout() {
  const [loaded, error] = useLoadFonts()
  const colorScheme = useColorScheme()

  useEffect(() => {
    if (error) throw error
  }, [error])

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {})
  }, [loaded])

  if (!loaded) return null

  return (
    <Providers colorScheme={colorScheme}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
      </Stack>
    </Providers>
  )
}

function Providers({
  children,
  colorScheme,
}: {
  children: React.ReactNode
  colorScheme: ReturnType<typeof useColorScheme>
}) {
  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <GluestackUIProvider>
            <View className="flex-1 bg-background">{children}</View>
            <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
          </GluestackUIProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function useLoadFonts(): [boolean, Error | null] {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await Font.loadAsync(FontAwesome.font)
      } catch (loadError) {
        if (!cancelled) setError(loadError as Error)
        return
      }
      if (!cancelled) setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return [loaded, error]
}
