import type { Metadata } from 'next'
import { ReviewRoom } from '../../../components/ReviewRoom'

export const metadata: Metadata = {
  title: '匿名审片',
  robots: { index: false, follow: false, nocache: true },
}

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <ReviewRoom token={token} />
}
