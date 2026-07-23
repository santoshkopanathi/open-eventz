'use client'

import { useEffect, useState } from 'react'
import { CONSENT_KEY, updateConsent } from '@/lib/analytics'

// Cookie-consent banner backing Google Consent Mode v2. GA4 loads with analytics_storage
// defaulted to 'denied' (set in layout.tsx before the config call), so nothing is stored
// until the user makes a choice here. Accepting grants analytics cookies; declining keeps
// the cookieless-default state. The choice is remembered in localStorage.
export default function ConsentBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY)
    if (stored === 'granted') {
      // Re-apply the prior grant on each load (Consent Mode default is denied every load).
      updateConsent(true)
    } else if (stored !== 'denied') {
      setShow(true)
    }
  }, [])

  const choose = (granted: boolean) => {
    localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied')
    updateConsent(granted)
    setShow(false)
  }

  if (!show) return null

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-0 inset-x-0 z-[100] p-4"
    >
      <div
        className="max-w-3xl mx-auto rounded-xl border shadow-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3"
        style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      >
        <p className="text-sm leading-relaxed flex-1">
          We use analytics cookies to understand how families use Open Eventz and improve it.
          You can accept or decline — declining keeps everything working.
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => choose(false)}
            className="px-4 py-2 rounded-lg text-sm font-semibold border transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Decline
          </button>
          <button
            onClick={() => choose(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
