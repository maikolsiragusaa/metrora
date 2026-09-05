import { Panel } from '../components/Panel'
import { ShareConnectSurface } from '../components/ShareConnectSurface'
import { usePolled } from '../hooks/usePolled'
import { metrora } from '../lib/ipc'
import { motionClass } from '../lib/motion'
import type { ShareStatus } from '../lib/types'

export function Companion({ refreshToken = 0, onRefresh, refreshing = false }: { refreshToken?: number; onRefresh?: () => void; refreshing?: boolean }) {
  const shareStatus = usePolled<ShareStatus>(() => metrora.getShareStatus(), [refreshToken], { intervalMs: 2500 })

  return (
    <>
      <div className="bar companion-bar">
        <div className="t">Companion</div>
        <span className="scope">Android pairing and local device sync</span>
        <div className="sp" />
        {onRefresh && <button type="button" className="btn btn-s refresh-button" onClick={onRefresh} disabled={refreshing} aria-label={refreshing ? 'Refreshing' : 'Refresh'}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>}
      </div>
      <div className={motionClass('body companion-body', 'section-fade')}>
        <div className="control-center-section__intro">
          <div>
            <span className="eyebrow">Metrora Companion</span>
            <h1>Keep your local control center close.</h1>
            <p>Pair an Android device through the existing Metrora connection flow. Nothing new is required on the desktop side.</p>
          </div>
        </div>
        <Panel title="Device pairing" right={shareStatus.data?.peers ? `${shareStatus.data.peers} connected` : undefined}>
          <ShareConnectSurface shareStatus={shareStatus} />
        </Panel>
      </div>
    </>
  )
}
