import { Link } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { FontAwesome } from '@expo/vector-icons'
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated'

import { useMobileSession } from '@/src/mobile-session'
import { Button, ButtonText } from '@/src/components/ui/button'

const STACK = [
  { icon: 'rocket', label: 'Expo SDK 54' },
  { icon: 'random', label: 'Expo Router' },
  { icon: 'paint-brush', label: 'NativeWind v5' },
  { icon: 'cube', label: 'gluestack v5' },
  { icon: 'bolt', label: 'Reanimated 4' },
  { icon: 'shield', label: 'Contract v2' },
]

const FEATURES = [
  { icon: 'magic', label: 'AI 短剧创作', hint: '云端模型 · 流式生成' },
  { icon: 'cloud-upload', label: '多端同步', hint: 'Web · Admin · Mobile' },
  { icon: 'bolt', label: '60fps 动效', hint: 'Reanimated 工作线程' },
  { icon: 'lock', label: '安全网关', hint: '无客户端密钥' },
]

export default function HomeScreen() {
  const session = useMobileSession()
  const authenticated = session.status === 'authenticated'

  return (
    <ScrollView className="flex-1 bg-ink" contentContainerStyle={{ flexGrow: 1 }}>
      <StatusBar style="light" />

      <View className="absolute inset-0 overflow-hidden">
        <View className="absolute -top-40 -right-32 h-80 w-80 rounded-full bg-brand-500 opacity-25" />
        <View className="absolute top-44 -left-28 h-72 w-72 rounded-full bg-rust opacity-20" />
        <View className="absolute bottom-10 right-10 h-40 w-40 rounded-full bg-sand opacity-10" />
      </View>

      <View className="relative flex-1 items-center justify-center px-6 py-16">
        <Animated.View
          entering={ZoomIn.delay(80).springify().damping(14)}
          className="mb-7 h-24 w-24 items-center justify-center rounded-[28px] bg-brand-500"
          style={{ shadowColor: '#c85532', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12 }}
        >
          <FontAwesome name="film" size={44} color="#fff8f2" />
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.delay(180).springify()}
          className="text-center text-4xl font-bold tracking-tight text-white"
        >
          尽意 DramaIP
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.delay(260).springify()}
          className="mt-3 text-center text-base text-sand"
        >
          尽作者之意，成万象之作
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(320).springify()} className="mt-2 text-center text-sm text-sand/60">
          AI IP 创作工作台 · 移动端
        </Animated.Text>

        <Animated.View entering={FadeIn.delay(420)} className="mt-9 flex-row flex-wrap justify-center gap-2 px-2">
          {STACK.map((item) => (
            <View
              key={item.label}
              className="flex-row items-center rounded-full border border-white/10 bg-white/5 px-3 py-1.5"
            >
              <FontAwesome name={item.icon as never} size={11} color="#eadbc8" />
              <Text className="ml-1.5 text-xs text-sand">{item.label}</Text>
            </View>
          ))}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(560)} className="mt-10 w-full flex-row flex-wrap justify-center gap-3">
          {FEATURES.map((feature) => (
            <View
              key={feature.label}
              className="w-[44%] rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              <View className="mb-3 h-9 w-9 items-center justify-center rounded-xl bg-brand-500/20">
                <FontAwesome name={feature.icon as never} size={16} color="#c85532" />
              </View>
              <Text className="text-sm font-semibold text-white">{feature.label}</Text>
              <Text className="mt-0.5 text-xs text-sand/60">{feature.hint}</Text>
            </View>
          ))}
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(700)}
          className="mt-8 w-full overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5"
        >
          <View className="flex-row items-center">
            <FontAwesome name={authenticated ? 'user-circle' : 'signal'} size={15} color="#c85532" />
            <Text className="ml-2 text-sm font-semibold text-white">运行环境</Text>
          </View>
          <View className="mt-4 gap-2.5">
            <StatusRow label="后端 API" value={session.apiOrigin || '未配置'} ok={session.configured} />
            <StatusRow
              label="登录状态"
              value={authenticated ? session.email : '匿名'}
              ok={authenticated}
            />
            <StatusRow label="运行时" value="New Arch · RN 0.81" ok />
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(820)} className="mt-8 w-full">
          <Button
            size="lg"
            className="w-full flex-row items-center justify-center bg-brand-500 active:bg-brand-700"
            onPress={() => {}}
          >
            <ButtonText className="font-semibold text-white">连接后端</ButtonText>
            <FontAwesome name="arrow-right" size={14} color="#ffffff" style={{ marginLeft: 8 }} />
          </Button>
          <View className="mt-4 flex-row items-center justify-center gap-3">
            <Button variant="outline" size="sm" className="border-white/15 bg-white/5">
              <ButtonText className="text-sand">gluestack</ButtonText>
            </Button>
            <Button variant="link" size="sm" className="px-2">
              <ButtonText className="text-sand/70">v5 组件</ButtonText>
            </Button>
          </View>
          <Link href="/+not-found" className="mt-4 text-center text-xs text-sand/60">
            验证 Expo Router 路由 →
          </Link>
        </Animated.View>
      </View>
    </ScrollView>
  )
}

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-xs text-sand/60">{label}</Text>
      <View className="max-w-[62%] flex-row items-center">
        <View className={`mr-2 h-1.5 w-1.5 rounded-full ${ok ? 'bg-green-400' : 'bg-sand/40'}`} />
        <Text className="text-right text-xs text-sand" numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  )
}
