import { Link } from 'expo-router'
import { Text, View } from 'react-native'

export default function HomeScreen() {
  return (
    <View className="flex-1 justify-center gap-4 bg-white px-6">
      <Text className="text-3xl font-semibold text-slate-950">DramaIP Mobile</Text>
      <Text className="text-base leading-6 text-slate-600">
        Capture ideas, draft characters, and check your token balance on the go.
      </Text>
      <Link href="/(auth)/login" className="text-base font-medium text-blue-600">
        Login
      </Link>
    </View>
  )
}
