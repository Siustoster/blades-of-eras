/**
 * Home.tsx — the page that hosts the game canvas plus the DOM HUD/menus.
 *
 * React only owns the DOM shell; everything inside the render loop lives under
 * src/game/ and never re-renders React. HUD state arrives through the bridge
 * (useSyncExternalStore), buttons call back into the game through bridge.act().
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { startGame, stopGame } from '@/game/boot'
import { bridge } from '@/game/bridge'
import { ERAS, ERA_ORDER, type EraId } from '@/game/config'

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hud = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot)
  const [cursor, setCursor] = useState({ x: -100, y: -100, visible: false })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    startGame(canvas)
    return () => stopGame()
  }, [])

  useEffect(() => {
    const move = (e: MouseEvent) => setCursor({ x: e.clientX, y: e.clientY, visible: true })
    const leave = () => setCursor((c) => ({ ...c, visible: false }))
    window.addEventListener('mousemove', move)
    document.documentElement.addEventListener('mouseleave', leave)
    return () => {
      window.removeEventListener('mousemove', move)
      document.documentElement.removeEventListener('mouseleave', leave)
    }
  }, [])

  const act = bridge.act()
  const era = ERAS[hud.era]
  const playing = hud.screen === 'playing'
  const hpPct = (v: number) => `${Math.max(0, (v / hud.hpMax) * 100)}%`

  return (
    <div id="game-root" className={playing ? 'in-duel' : ''}>
      <canvas id="game-canvas" ref={canvasRef} />
      <div id="ui-overlay">
        {/* custom crosshair while the cursor steers the blade */}
        {playing && cursor.visible && (
          <div className="crosshair" style={{ left: cursor.x, top: cursor.y }} />
        )}

        {/* top HUD: health bars */}
        {(playing || hud.screen === 'paused') && (
          <div className="hud-top">
            <div className="hp-block">
              <div className="hp-name">Вы</div>
              <div className="hp-bar">
                <div className="hp-fill hp-player" style={{ width: hpPct(hud.hpP) }} />
              </div>
            </div>
            <div className="hud-center">
              <div className="era-tag" style={{ color: era.ui }}>{era.name}</div>
              {hud.countdown > 0 && (
                <div className="countdown">{Math.ceil(hud.countdown / 0.6)}</div>
              )}
            </div>
            <div className="hp-block hp-right">
              <div className="hp-name">{era.name === 'Неон' ? 'Андроид' : 'Противник'}</div>
              <div className="hp-bar">
                <div className="hp-fill hp-enemy" style={{ width: hpPct(hud.hpE) }} />
              </div>
            </div>
          </div>
        )}

        {/* combat flash (parry / riposte / hit) */}
        {hud.flash && playing && hud.flash.text && (
          <div key={hud.flash.id} className={`flash flash-${hud.flash.kind}`}>
            {hud.flash.text}
          </div>
        )}

        {/* hurt vignette + low-hp pulse */}
        {playing && <div key={`h${hud.hurtPulse}`} className="hurt-vignette" />}
        {playing && hud.hpP <= 30 && <div className="lowhp-vignette" />}

        {/* hint line */}
        {playing && hud.hint && <div className="hint">{hud.hint}</div>}

        {/* controls reminder */}
        {playing && (
          <div className="controls-hint">
            мышь — клинок · ЛКМ — выпад · ПКМ — защита · WASD — ноги · Esc — пауза
          </div>
        )}

        {/* title screen: era select */}
        {hud.screen === 'title' && (
          <div className="menu title-menu">
            <h1 className="game-title">Клинки эпох</h1>
            <p className="game-subtitle">Дуэль на мечах. Клинком управляет ваша мышь.</p>
            <div className="era-grid">
              {ERA_ORDER.map((id: EraId) => {
                const e = ERAS[id]
                const rec = hud.records[id]
                const selected = id === hud.era
                return (
                  <button
                    key={id}
                    className={`era-card ${selected ? 'selected' : ''}`}
                    style={{ ['--era' as string]: e.ui }}
                    onClick={() => act?.setEra(id)}
                  >
                    <span className="era-name">{e.name}</span>
                    <span className="era-weapon">{e.weapon}</span>
                    <span className="era-epithet">{e.epithet}</span>
                    <span className="era-record">
                      {rec.wins}П / {rec.losses}Пр{rec.bestParries > 0 ? ` · рекорд парирований ${rec.bestParries}` : ''}
                    </span>
                  </button>
                )
              })}
            </div>
            <button className="btn btn-primary" onClick={() => act?.start()}>
              К бою (Space)
            </button>
            <p className="menu-foot">
              Резкие движения мышью — удары · ЛКМ — выпад · ПКМ — защита · парирование — клинок в красный блик
            </p>
          </div>
        )}

        {/* pause */}
        {hud.screen === 'paused' && (
          <div className="menu">
            <h2 className="menu-title">Пауза</h2>
            <button className="btn btn-primary" onClick={() => act?.resume()}>Продолжить (Esc)</button>
            <button className="btn" onClick={() => act?.restart()}>Начать дуэль заново</button>
            <button className="btn" onClick={() => act?.toggleMute()}>
              Звук: {hud.muted ? 'выкл' : 'вкл'} (M)
            </button>
            <button className="btn btn-ghost" onClick={() => act?.toTitle()}>Сменить эпоху</button>
          </div>
        )}

        {/* duel result */}
        {hud.screen === 'gameover' && (
          <div className="menu">
            <h2 className={`menu-title ${hud.win ? 'win' : 'lose'}`}>
              {hud.win ? 'Победа!' : 'Поражение'}
            </h2>
            <div className="stats">
              <div><span>Удары нанесены</span><b>{hud.stats.hits}</b></div>
              <div><span>Парирования</span><b>{hud.stats.parries}</b></div>
              <div><span>Урон нанесён</span><b>{hud.stats.dealt}</b></div>
              <div><span>Урон получен</span><b>{hud.stats.taken}</b></div>
              <div><span>Время дуэли</span><b>{hud.stats.timeSec} с</b></div>
            </div>
            <button className="btn btn-primary" onClick={() => act?.restart()}>Ещё раз (R)</button>
            <button className="btn btn-ghost" onClick={() => act?.toTitle()}>Сменить эпоху</button>
          </div>
        )}
      </div>
    </div>
  )
}
