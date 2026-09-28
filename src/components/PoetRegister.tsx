import { poemsByAuthor, trailLengthKm } from '../lib/poetGeography'
import type { Poem, PoetProfile } from '../types'

// Every sketch shares one frame (the settled core of the map, with far
// frontier stations pinned to its edge), so a life spent in 江南 visibly sits
// apart from one spent on the frontier.
const frame = { west: 86, east: 125, south: 20, north: 45 }
const sketchWidth = 88
const sketchHeight = 52

function sketchPoint(longitude: number, latitude: number) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  const x = clamp((longitude - frame.west) / (frame.east - frame.west), 0.03, 0.97) * sketchWidth
  const y = clamp((frame.north - latitude) / (frame.north - frame.south), 0.04, 0.96) * sketchHeight
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as const
}

// A rough coastline from 北部湾 to 辽东, only there to orient the eye.
const coast = [
  [108.5, 21.6], [110.4, 20.4], [111.2, 21.5], [113.5, 22.2], [116.5, 23], [118.5, 24.6],
  [119.6, 26], [120.6, 28], [121.9, 30.9], [120.9, 32.5], [120.3, 34.3], [119.3, 35],
  [120.6, 36.2], [122.4, 37.2], [120.9, 37.7], [119, 37.2], [118, 38.3], [118.6, 39.2],
  [121.2, 40.9], [122.2, 40.4], [121.2, 39], [122.6, 39.4], [124.2, 39.9],
]
  .map(([longitude, latitude]) => sketchPoint(longitude, latitude).join(','))
  .join(' ')

export function PoetSketch({ poet }: { poet: PoetProfile }) {
  const points = poet.stations.map((station) => sketchPoint(station.longitude, station.latitude))
  const [homeX, homeY] = sketchPoint(poet.hometown.longitude, poet.hometown.latitude)
  return (
    <svg
      className="poet-sketch"
      viewBox={`0 0 ${sketchWidth} ${sketchHeight}`}
      aria-hidden="true"
      focusable="false"
    >
      <polyline className="poet-sketch-coast" points={coast} />
      <polyline className="poet-sketch-route" points={points.map(([x, y]) => `${x},${y}`).join(' ')} />
      {points.map(([x, y], index) => (
        <circle key={index} cx={x} cy={y} r={index === points.length - 1 ? 1.9 : 1.2} />
      ))}
      <rect x={homeX - 2} y={homeY - 2} width="4" height="4" />
    </svg>
  )
}

interface PoetRegisterProps {
  poets: PoetProfile[]
  corpus: Poem[]
  selectedAuthor: string
  unprofiledAuthors: number
  onChoosePoet: (poet: PoetProfile) => void
}

export function PoetRegister({
  poets,
  corpus,
  selectedAuthor,
  unprofiledAuthors,
  onChoosePoet,
}: PoetRegisterProps) {
  return (
    <div className="poet-register" role="list" aria-label="诗人与行迹">
      {poets.map((poet) => {
        const works = poemsByAuthor(poet.name, corpus)
        return (
          <button
            key={poet.id}
            type="button"
            role="listitem"
            data-library-poet={poet.name}
            className={poet.name === selectedAuthor ? 'active' : undefined}
            aria-current={poet.name === selectedAuthor ? 'true' : undefined}
            aria-label={`${poet.name}，${poet.lifeLabel}，${works.length}首，查看行迹`}
            onClick={() => onChoosePoet(poet)}
          >
            <PoetSketch poet={poet} />
            <span className="poet-card-text">
              <strong>{poet.name}</strong>
              <small>{poet.lifeLabel}{poet.epithet ? ` · ${poet.epithet}` : ''}</small>
              <em>
                {works.length}首 · {poet.stations.length}站 · 籍{poet.hometown.placeName}
                {' · '}约{Math.round(trailLengthKm(poet) / 100) * 100}公里
              </em>
            </span>
          </button>
        )
      })}
      {poets.length === 0 && (
        <p className="library-empty">没有匹配的诗人。</p>
      )}
      {unprofiledAuthors > 0 && (
        <p className="poet-register-note">另有{unprofiledAuthors}位作者或佚名之作，生平行迹暂未编入。</p>
      )}
    </div>
  )
}
