import { AccountDashboard } from '../../components/AccountDashboard'

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">Account</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Profile, active subscription, and monthly token balance from the BFF.
      </p>
      <div className="mt-8">
        <AccountDashboard />
      </div>
    </main>
  )
}
