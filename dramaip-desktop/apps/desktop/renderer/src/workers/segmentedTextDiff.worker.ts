import { buildSegmentedTextDiff } from '@/lib/segmentedTextDiff'

self.onmessage = (event: MessageEvent<{ previous: string; next: string }>) => {
  self.postMessage(buildSegmentedTextDiff(event.data.previous, event.data.next))
}
