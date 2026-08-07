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
      className="fixed bottom-0 inset-x-0 z-[100] p-2 sm:p-3"
    >
      {/* Slim single-line bar — stays a compact strip so it barely covers the list on mobile
          (the row never stacks; buttons stay inline right, the copy takes at most two short lines). */}
      <div
        className="max-w-3xl mx-auto rounded-lg border shadow-lg py-2 pl-3.5 pr-2 flex items-center gap-3"
        style={{ backgroundColor: 'var(--color-card)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
      >
        <p className="text-xs leading-snug flex-1">
          Analytics cookies help us improve Open Eventz. Declining keeps everything working.
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => choose(false)}
            className="px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors hover:bg-gray-50"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Decline
          </button>
          <button
            onClick={() => choose(true)}
            className="px-3 py-1.5 rounded-md text-xs font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
