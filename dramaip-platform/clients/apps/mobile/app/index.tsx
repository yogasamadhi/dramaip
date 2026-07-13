import { useCallback, useEffect, useState } from 'react'
import { Link, router } from 'expo-router'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { getBrief, restoreSession, signOut, type MobileBrief } from '../src/mobile-session'

export default function HomeScreen() {
  const [brief, setBrief] = useState<MobileBrief>()
  const [state, setState] = useState<'loading' | 'signed_out' | 'expired' | 'offline' | 'ready'>('loading')
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    setState('loading')
    setError(undefined)
    const restored = await restoreSession()
    if (restored.state !== 'signed_in') {
      setState(restored.state)
      return
    }
    try {
      setBrief(await getBrief())
      setState('ready')
    } catch (reason) {
      setState('offline')
      setError(reason instanceof Error ? reason.message : '无法获取账户摘要')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const logout = async () => {
    await signOut()
    setBrief(undefined)
    setState('signed_out')
  }

  return (
    <View className="flex-1 justify-center gap-4 bg-white px-6">
      <Text className="text-3xl font-semibold text-slate-950">DramaIP Mobile</Text>
      {state === 'loading' ? <ActivityIndicator /> : null}
      {state === 'ready' && brief ? (
        <>
          <Text className="text-base leading-6 text-slate-600">轻量账户摘要；灵感与草稿同步会在后续功能中提供。</Text>
          <View className="rounded-lg border border-slate-200 p-4">
            <Text className="text-lg font-medium text-slate-950">{brief.displayName}</Text>
            <Text className="mt-2 text-slate-600">套餐：{brief.plan}</Text>
            <Text className="text-slate-600">剩余额度：{brief.remainingTokens.toLocaleString()} tokens</Text>
          </View>
          <Pressable className="h-11 items-center justify-center rounded-md border border-slate-300" onPress={() => void load()}><Text className="font-medium text-slate-800">刷新账户</Text></Pressable>
          <Pressable className="h-11 items-center justify-center rounded-md bg-slate-900" onPress={() => void logout()}><Text className="font-medium text-white">退出登录</Text></Pressable>
        </>
      ) : null}
      {state === 'signed_out' || state === 'expired' ? (
        <>
          <Text className="text-base leading-6 text-slate-600">{state === 'expired' ? '登录已过期，请重新登录。' : '请登录以查看套餐和余额。'}</Text>
          <Link href="/(auth)/login" className="text-base font-medium text-blue-600">前往登录</Link>
        </>
      ) : null}
      {state === 'offline' ? (
        <>
          <Text className="text-base leading-6 text-slate-600">网络暂不可用。已保留本地安全会话，恢复网络后可重试。</Text>
          {error ? <Text className="text-sm text-amber-700">{error}</Text> : null}
          <Pressable className="h-11 items-center justify-center rounded-md border border-slate-300" onPress={() => void load()}><Text className="font-medium text-slate-800">重试</Text></Pressable>
          <Pressable className="h-11 items-center justify-center" onPress={() => router.push('/(auth)/login')}><Text className="font-medium text-blue-600">改用其他账号登录</Text></Pressable>
        </>
      ) : null}
    </View>
  )
}
