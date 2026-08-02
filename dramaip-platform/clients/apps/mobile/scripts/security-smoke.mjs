import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const [session, drafts, appConfig] = await Promise.all([
  readFile(resolve(root, 'src/mobile-session.ts'), 'utf8'),
  readFile(resolve(root, 'src/mobile-drafts.ts'), 'utf8'),
  readFile(resolve(root, 'app.json'), 'utf8'),
])

if (!session.includes("from 'expo-secure-store'")) throw new Error('mobile session must use Expo SecureStore')
if (!session.includes('setItemAsync(REFRESH_TOKEN_KEY')) throw new Error('refresh token is not stored in SecureStore')
if (!session.includes('let accessToken')) throw new Error('access token must remain module-memory only')
if (/AsyncStorage|setItemAsync\(ACCESS_TOKEN/i.test(session)) throw new Error('mobile session exposes an unsafe token storage path')
if (!appConfig.includes('expo-secure-store')) throw new Error('Expo SecureStore native plugin is not enabled')
if (!drafts.includes("from '@react-native-async-storage/async-storage'")) throw new Error('offline draft queue must use local non-secret storage')
if (!drafts.includes("'/api/v1/drafts'")) throw new Error('offline draft queue has no mobile API endpoint')
if (drafts.includes('expo-secure-store') || /refresh[_-]?token|access[_-]?token/i.test(drafts)) throw new Error('draft queue must not read or persist session credentials')

console.log('Mobile security storage smoke OK')
