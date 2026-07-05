import { Text, TextInput, View } from 'react-native'

export default function LoginScreen() {
  return (
    <View className="flex-1 gap-4 bg-white px-6 py-12">
      <Text className="text-3xl font-semibold text-slate-950">Login</Text>
      <TextInput className="h-12 rounded-md border border-slate-300 px-3" placeholder="Email" />
      <TextInput
        className="h-12 rounded-md border border-slate-300 px-3"
        placeholder="Password"
        secureTextEntry
      />
    </View>
  )
}
