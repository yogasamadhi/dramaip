import { useState } from 'react'
import { router } from 'expo-router'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { signIn } from '../../src/mobile-session'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const login = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await signIn(email, password)
      router.replace('/')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View className="flex-1 gap-4 bg-white px-6 py-12">
      <Text className="text-3xl font-semibold text-slate-950">Login</Text>
      <Text className="text-sm leading-5 text-slate-600">登录凭据仅用于本次 HTTPS 请求；长期 refresh token 由系统安全存储保管。</Text>
      <TextInput className="h-12 rounded-md border border-slate-300 px-3" placeholder="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <TextInput
        className="h-12 rounded-md border border-slate-300 px-3"
        placeholder="Password"
        secureTextEntry
        autoComplete="current-password"
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text className="text-sm text-red-700">{error}</Text> : null}
      <Pressable className="h-12 items-center justify-center rounded-md bg-blue-600" onPress={() => void login()} disabled={busy || !email.trim() || !password}>
        {busy ? <ActivityIndicator color="#ffffff" /> : <Text className="font-medium text-white">登录</Text>}
      </Pressable>
    </View>
  )
}
