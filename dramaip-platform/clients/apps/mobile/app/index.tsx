import { useCallback, useEffect, useState } from 'react'
import { Link } from 'expo-router'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { getBrief, restoreSession, signOut, type MobileBrief } from '../src/mobile-session'
import {
  expandMobileDraft,
  exportLocalDrafts,
  listLocalDrafts,
  queueDraft,
  syncQueuedDrafts,
  type MobileCaptureMode,
  type MobileDraftKind,
} from '../src/mobile-drafts'

type ScreenState = 'loading' | 'signed_out' | 'expired' | 'offline' | 'ready'

const kinds: { value: MobileDraftKind; label: string }[] = [
  { value: 'inspiration', label: '灵感' }, { value: 'character', label: '人物' }, { value: 'project', label: '项目' },
]

export default function HomeScreen() {
  const [brief, setBrief] = useState<MobileBrief>()
  const [state, setState] = useState<ScreenState>('loading')
  const [error, setError] = useState<string>()
  const [kind, setKind] = useState<MobileDraftKind>('inspiration')
  const [captureMode, setCaptureMode] = useState<MobileCaptureMode>('text')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [expansion, setExpansion] = useState('')
  const [localCount, setLocalCount] = useState(0)
  const [busy, setBusy] = useState<'save' | 'expand' | 'sync' | 'export'>()
  const [notice, setNotice] = useState<string>()

  const refreshLocalCount = useCallback(async () => setLocalCount((await listLocalDrafts()).length), [])

  const load = useCallback(async () => {
    setState('loading')
    setError(undefined)
    await refreshLocalCount()
    const restored = await restoreSession()
    if (restored.state !== 'signed_in') {
      setState(restored.state)
      return
    }
    try {
      setBrief(await getBrief())
      const replay = await syncQueuedDrafts()
      await refreshLocalCount()
      if (replay.synced) setNotice(`已同步 ${replay.synced} 条离线草稿`)
      setState('ready')
    } catch (reason) {
      setState('offline')
      setError(reason instanceof Error ? reason.message : '无法获取账户摘要')
    }
  }, [refreshLocalCount])

  useEffect(() => { void load() }, [load])

  const logout = async () => {
    await signOut()
    setBrief(undefined)
    setState('signed_out')
  }

  const saveDraft = async () => {
    setBusy('save')
    setNotice(undefined)
    try {
      await queueDraft({ kind, captureMode, title, content, aiExpansion: expansion })
      const result = await syncQueuedDrafts()
      await refreshLocalCount()
      setTitle('')
      setContent('')
      setExpansion('')
      setNotice(result.pending ? `草稿已安全保存在本机，待网络恢复后同步（${result.pending} 条待发）` : '草稿已同步，可在桌面端灵感台显式采用')
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '保存草稿失败')
    } finally {
      setBusy(undefined)
    }
  }

  const expand = async () => {
    setBusy('expand')
    setNotice(undefined)
    try {
      setExpansion(await expandMobileDraft(kind, content))
      setNotice('扩写已生成；保存草稿后才会同步到桌面端。')
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '扩写暂不可用')
    } finally {
      setBusy(undefined)
    }
  }

  const replay = async () => {
    setBusy('sync')
    try {
      const result = await syncQueuedDrafts()
      await refreshLocalCount()
      setNotice(result.pending ? `仍有 ${result.pending} 条草稿待网络恢复后同步` : `离线队列已同步 ${result.synced} 条`)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '同步暂不可用')
    } finally {
      setBusy(undefined)
    }
  }

  const exportDrafts = async () => {
    setBusy('export')
    try {
      const result = await exportLocalDrafts()
      setNotice(result.shared ? '已打开系统分享，可发送到桌面端“导入移动灵感”。' : `已生成交接文件：${result.uri}`)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : '导出失败')
    } finally {
      setBusy(undefined)
    }
  }

  const composerVisible = state === 'ready' || state === 'offline'

  return (
    <ScrollView className="flex-1 bg-white" contentContainerClassName="gap-4 px-6 py-10">
      <Text className="text-3xl font-semibold text-slate-950">DramaIP Mobile</Text>
      {state === 'loading' ? <ActivityIndicator /> : null}
      {state === 'ready' && brief ? (
        <View className="rounded-lg border border-slate-200 p-4">
          <Text className="text-lg font-medium text-slate-950">{brief.displayName}</Text>
          <Text className="mt-1 text-slate-600">套餐：{brief.plan} · 剩余额度：{brief.remainingTokens.toLocaleString()} tokens</Text>
        </View>
      ) : null}
      {state === 'offline' ? <Text className="text-sm leading-5 text-amber-700">网络暂不可用，草稿仍会保存在本机队列中，不会丢失。{error ? ` ${error}` : ''}</Text> : null}
      {state === 'signed_out' || state === 'expired' ? (
        <>
          <Text className="text-base leading-6 text-slate-600">{state === 'expired' ? '登录已过期，请重新登录。' : '请登录以同步灵感、查看套餐和余额。'}</Text>
          <Link href="/(auth)/login" className="text-base font-medium text-blue-600">前往登录</Link>
        </>
      ) : null}

      {composerVisible ? (
        <View className="gap-3 rounded-xl border border-slate-200 p-4">
          <View>
            <Text className="text-lg font-semibold text-slate-950">随手草稿</Text>
            <Text className="mt-1 text-sm leading-5 text-slate-600">只记录轻量灵感、人物或项目方向；桌面端必须由你显式采用，绝不自动覆盖正文。</Text>
          </View>
          <View className="flex-row gap-2">
            {kinds.map((option) => <ModeButton key={option.value} label={option.label} active={kind === option.value} onPress={() => setKind(option.value)} />)}
          </View>
          <View className="flex-row gap-2">
            <ModeButton label="文字" active={captureMode === 'text'} onPress={() => setCaptureMode('text')} />
            <ModeButton label="语音听写" active={captureMode === 'voice'} onPress={() => setCaptureMode('voice')} />
          </View>
          {captureMode === 'voice' ? <Text className="text-xs leading-4 text-slate-500">使用系统键盘的语音听写转成文字；应用不会录制或上传原始音频。</Text> : null}
          <TextInput className="h-11 rounded-md border border-slate-300 px-3" placeholder="给这条草稿一个标题" maxLength={120} value={title} onChangeText={setTitle} />
          <TextInput className="min-h-28 rounded-md border border-slate-300 px-3 py-2 align-top" placeholder="记录触发点、人物关系或项目方向…" multiline maxLength={3000} value={content} onChangeText={setContent} />
          <Text className="text-xs leading-4 text-slate-500">AI 快速扩写只发送上面的文字（最多 1,500 字符），不会上传桌面项目、文件路径或音频。</Text>
          <Pressable className="h-11 items-center justify-center rounded-md border border-blue-300" onPress={() => void expand()} disabled={busy !== undefined || !content.trim()}>
            {busy === 'expand' ? <ActivityIndicator /> : <Text className="font-medium text-blue-700">AI 快速扩写</Text>}
          </Pressable>
          {expansion ? <TextInput className="min-h-24 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 align-top text-slate-800" multiline value={expansion} onChangeText={setExpansion} /> : null}
          <Pressable className="h-12 items-center justify-center rounded-md bg-slate-900" onPress={() => void saveDraft()} disabled={busy !== undefined || !title.trim() || !content.trim()}>
            {busy === 'save' ? <ActivityIndicator color="#ffffff" /> : <Text className="font-medium text-white">保存并尝试同步</Text>}
          </Pressable>
          <View className="flex-row gap-2">
            <Pressable className="h-10 flex-1 items-center justify-center rounded-md border border-slate-300" onPress={() => void replay()} disabled={busy !== undefined}><Text className="font-medium text-slate-800">重放队列（{localCount}）</Text></Pressable>
            <Pressable className="h-10 flex-1 items-center justify-center rounded-md border border-slate-300" onPress={() => void exportDrafts()} disabled={busy !== undefined}><Text className="font-medium text-slate-800">导出交接包</Text></Pressable>
          </View>
          {notice ? <Text className="text-sm leading-5 text-slate-600">{notice}</Text> : null}
        </View>
      ) : null}

      {state === 'ready' ? (
        <>
          <Pressable className="h-11 items-center justify-center rounded-md border border-slate-300" onPress={() => void load()}><Text className="font-medium text-slate-800">刷新账户与队列</Text></Pressable>
          <Pressable className="h-11 items-center justify-center rounded-md bg-slate-900" onPress={() => void logout()}><Text className="font-medium text-white">退出登录</Text></Pressable>
        </>
      ) : null}
      {state === 'offline' ? <Pressable className="h-11 items-center justify-center rounded-md border border-slate-300" onPress={() => void load()}><Text className="font-medium text-slate-800">恢复网络后重试</Text></Pressable> : null}
    </ScrollView>
  )
}

function ModeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable className={`h-9 flex-1 items-center justify-center rounded-md border ${active ? 'border-blue-600 bg-blue-50' : 'border-slate-300'}`} onPress={onPress}><Text className={active ? 'font-medium text-blue-700' : 'text-slate-700'}>{label}</Text></Pressable>
}
