import { useEffect, useRef, type CSSProperties } from 'react'
import { dynastyLabels } from '../data/mapSnapshots'
import { confidenceLabels, datePrecisionLabels, relationLabels } from '../data/poems'
import {
  ageAtPoem,
  companionsOf,
  distanceKm,
  poetOf,
  poetStages,
  samePlacePoems,
  stationIndexForPoem,
  trailLengthKm,
} from '../lib/poetGeography'
import type { MapSnapshot, Poem, PoetProfile } from '../types'

interface PoemFolioProps {
  poem: Poem
  snapshot: MapSnapshot
  /** Works of the active period, drawn as ticks on the time rule. */
  periodPoems: Poem[]
  /** The whole corpus: places and lives cross dynasty boundaries. */
  corpus: Poem[]
  trailOn: boolean
  trailFolded: boolean
  hidden: boolean
  onSelectPoem: (poem: Poem) => void
  onToggleTrail: () => void
  onShowWholeTrail: () => void
  onSelectCompanion: (poet: PoetProfile) => void
}

export function formatYear(year: number) {
  return year < 0 ? `前${-year}` : String(year)
}

function formatKm(km: number) {
  return km >= 1000 ? `${(km / 1000).toFixed(1)}千` : String(Math.round(km / 10) * 10)
}

function percentWithin(year: number, start: number, end: number) {
  if (end === start) return 50
  return Math.min(100, Math.max(0, ((year - start) / (end - start)) * 100))
}

function homeDistanceLabel(poet: PoetProfile, poem: Poem) {
  const km = distanceKm(poet.hometown, poem)
  if (km < 15) return '作于故乡'
  return `离乡约${formatKm(km)}公里`
}

function samePlaceSummary(poem: Poem, neighbours: Poem[]) {
  const dynasties = new Set([poem, ...neighbours].map((other) => other.dynasty)).size
  return dynasties > 1
    ? `此地另有 ${neighbours.length} 篇 · 历${dynasties}代`
    : `此地另有 ${neighbours.length} 篇`
}

export function PoemFolio({
  poem,
  snapshot,
  periodPoems,
  corpus,
  trailOn,
  trailFolded,
  hidden,
  onSelectPoem,
  onToggleTrail,
  onShowWholeTrail,
  onSelectCompanion,
}: PoemFolioProps) {
  const poet = poetOf(poem)
  const age = poet ? ageAtPoem(poet, poem) : undefined
  const companions = poet ? companionsOf(poet) : []
  const neighbours = samePlacePoems(poem, corpus)
  const stages = poet && trailOn ? poetStages(poet, corpus) : []
  const currentStation = poet ? stationIndexForPoem(poet, poem) : -1
  const stagesRef = useRef<HTMLOListElement>(null)
  // Keep the station this poem belongs to in view as the reader moves along
  // the life; the list scrolls on its own so the folio itself never jumps.
  useEffect(() => {
    const list = stagesRef.current
    const current = list?.querySelector<HTMLElement>('.is-current')
    if (!list || !current) return
    const listBox = list.getBoundingClientRect()
    const box = current.getBoundingClientRect()
    list.scrollTo({
      top: list.scrollTop + box.top - listBox.top - 8,
      left: list.scrollLeft + box.left - listBox.left - 8,
      behavior: 'smooth',
    })
  }, [poem.id, trailOn])
  const tickYears = [...new Set(periodPoems.map((periodPoem) => periodPoem.year))]
  const start = snapshot.startYear
  const end = snapshot.endYear
  const lifeStyle: Record<string, string> = poet
    ? {
      '--life-start': `${percentWithin(poet.birthYear, start, end)}%`,
      '--life-end': `${percentWithin(poet.deathYear, start, end)}%`,
    }
    : {}

  return (
    <aside
      className={trailOn ? 'poem-folio is-trailing' : 'poem-folio'}
      aria-hidden={hidden ? true : undefined}
      inert={hidden ? true : undefined}
      aria-label={`${poem.title}的时间、人物与地点`}
    >
      <section className="folio-row folio-time" aria-live="polite">
        <span className="folio-mark" aria-hidden="true">时</span>
        <div className="folio-body">
          <p className="folio-kicker">
            {dynastyLabels[poem.dynasty]} · {datePrecisionLabels[poem.datePrecision]}
          </p>
          <div className="era-year">{poem.yearLabel}</div>
          <p className="era-line">{poem.eraLabel}</p>
          <div
            className="era-rule"
            style={{
              '--era-progress': `${percentWithin(poem.year, start, end).toFixed(1)}%`,
              ...lifeStyle,
            } as CSSProperties}
            aria-hidden="true"
          >
            {poet && <span className="era-life" />}
            {tickYears.map((year) => (
              <i key={year} style={{ left: `${percentWithin(year, start, end)}%` }} />
            ))}
            <b />
          </div>
          <div className="era-rule-ends" aria-hidden="true">
            <span>{formatYear(start)}</span>
            {poet && <em>{poet.name}一生</em>}
            <span>{formatYear(end)}</span>
          </div>
        </div>
      </section>

      <section className="folio-row folio-person">
        <span className="folio-mark" aria-hidden="true">人</span>
        <div className="folio-body">
          {(poet?.styleName || poet?.epithet) && (
            <p className="folio-kicker">
              {[poet.styleName, poet.epithet].filter(Boolean).join(' · ')}
            </p>
          )}
          <h2>
            {poem.author}
            {poet && <small>{poet.lifeLabel}</small>}
          </h2>
          {poet ? (
            <p className="folio-facts">
              {age !== undefined && <span>作此篇时约{age}岁</span>}
              <span>籍 {poet.hometown.placeName}</span>
              <span>{homeDistanceLabel(poet, poem)}</span>
            </p>
          ) : (
            <p className="folio-facts"><span>生平行迹待考</span></p>
          )}
          {poet && (
            <div className="folio-actions">
              <button
                type="button"
                className="trail-toggle"
                aria-pressed={trailOn}
                onClick={onToggleTrail}
              >
                <span>{trailOn ? '收起行迹' : '行迹'}</span>
                <small>{poet.stations.length}站</small>
              </button>
              {companions.length > 0 && (
                <div className="companions" aria-label={`${poet.name}的同游`}>
                  <span>交游</span>
                  {companions.map((companion) => (
                    <button
                      key={companion.id}
                      type="button"
                      data-companion={companion.name}
                      title={`${companion.name} · ${companion.lifeLabel}${companion.epithet ? ` · ${companion.epithet}` : ''}`}
                      onClick={() => onSelectCompanion(companion)}
                    >
                      {companion.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {poet && trailOn && (
            <div className="trail-register">
              <p className="trail-summary">
                <span>{poet.summary}</span>
                <small>
                  行程约{formatKm(trailLengthKm(poet))}公里
                  {!trailFolded && (
                    <button type="button" onClick={onShowWholeTrail}>览全程</button>
                  )}
                </small>
              </p>
              <ol ref={stagesRef} className="trail-stages" aria-label={`${poet.name}生平行迹`}>
                {stages.map(({ station, index, poems: stagePoems }) => (
                  <li key={index} className={index === currentStation ? 'is-current' : undefined}>
                    <b>{index + 1}</b>
                    <div>
                      <p>
                        <time>{station.yearLabel}</time>
                        <strong>{station.placeName}</strong>
                      </p>
                      <span>{station.event}</span>
                      {stagePoems.length > 0 && (
                        <div className="trail-works">
                          {stagePoems.map((work) => (
                            <button
                              key={work.id}
                              type="button"
                              data-trail-poem={work.id}
                              aria-current={work.id === poem.id ? 'true' : undefined}
                              onClick={() => onSelectPoem(work)}
                            >
                              《{work.title}》
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </section>

      <section className="folio-row folio-place">
        <span className="folio-mark" aria-hidden="true">地</span>
        <div className="folio-body">
          <p className="folio-kicker">
            {relationLabels[poem.relation]} · {confidenceLabels[poem.confidence]}
          </p>
          <h3>{poem.placeName}</h3>
          {neighbours.length > 0 && (
            <div className="same-place" aria-label={`同在${poem.placeName}的作品`}>
              <p>{samePlaceSummary(poem, neighbours)}</p>
              <ul>
                {neighbours.slice(0, 5).map((other) => (
                  <li key={other.id}>
                    <button
                      type="button"
                      data-same-place-poem={other.id}
                      onClick={() => onSelectPoem(other)}
                    >
                      <em>{dynastyLabels[other.dynasty]}</em>
                      <span>{other.author}</span>
                      <strong>《{other.title}》</strong>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </aside>
  )
}
