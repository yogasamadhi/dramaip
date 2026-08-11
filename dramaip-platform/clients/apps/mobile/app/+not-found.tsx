import { Link } from 'expo-router'
import { Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { FontAwesome } from '@expo/vector-icons'
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated'

export default function NotFoundScreen() {
  return (
    <View className="flex-1 bg-ink">
      <StatusBar style="light" />
      <View className="flex-1 items-center justify-center px-6">
        <Animated.View
          entering={ZoomIn.delay(80).springify().damping(14)}
          className="mb-6 h-20 w-20 items-center justify-center rounded-3xl bg-rust/30"
        >
          <FontAwesome name="compass" size={36} color="#eadbc8" />
        </Animated.View>
        <Animated.Text entering={FadeInDown.delay(180)} className="text-3xl font-bold text-white">
          404
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(260)} className="mt-2 text-sm text-sand/70">
          这个页面还没有被创建
        </Animated.Text>
        <Link
          href="/"
          className="mt-8 flex-row items-center rounded-2xl bg-brand-500 px-6 py-3 active:bg-brand-700"
        >
          <FontAwesome name="arrow-left" size={13} color="#ffffff" style={{ marginRight: 8 }} />
          <Text className="text-sm font-semibold text-white">回到首页</Text>
        </Link>
      </View>
    </View>
  )
}
