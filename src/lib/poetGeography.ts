import { poetByName } from '../data/poets'
import type { GeoPlace, Poem, PoetProfile, PoetStation } from '../types'

const EARTH_RADIUS_KM = 6371

export function distanceKm(a: Pick<GeoPlace, 'longitude' | 'latitude'>, b: Pick<GeoPlace, 'longitude' | 'latitude'>) {
  const toRad = (degrees: number) => degrees * Math.PI / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function poetOf(poem: Pick<Poem, 'author'>): PoetProfile | undefined {
  return poetByName.get(poem.author)
}

/** Age at the time of writing; undefined when the date is only an era. */
export function ageAtPoem(poet: PoetProfile, poem: Pick<Poem, 'year' | 'datePrecision'>) {
  if (poem.datePrecision === 'period') return undefined
  const age = poem.year - poet.birthYear
  return age >= 0 && poem.year <= poet.deathYear ? age : undefined
}

/**
 * Works by other hands (or other years) written at, or about, the same spot.
 * Matching is by place id first and then by distance, so 金陵's 乌衣巷 and 台城
 * meet while 金陵 and 扬州 stay apart.
 */
export function samePlacePoems(poem: Poem, corpus: Poem[], radiusKm = 12) {
  return corpus
    .filter((other) => other.id !== poem.id
      && (other.placeId === poem.placeId || distanceKm(other, poem) <= radiusKm))
    .sort((a, b) => a.year - b.year || a.title.localeCompare(b.title, 'zh-CN'))
}

export function poemsByAuthor(author: string, corpus: Poem[]) {
  return corpus
    .filter((poem) => poem.author === author)
    .sort((a, b) => a.year - b.year || a.title.localeCompare(b.title, 'zh-CN'))
}

/** Index of the life station the poem belongs to (the last one not after it). */
export function stationIndexForPoem(poet: PoetProfile, poem: Pick<Poem, 'year'>) {
  let index = 0
  poet.stations.forEach((station, stationIndex) => {
    if (station.year <= poem.year) index = stationIndex
  })
  return index
}

export interface TrailStage {
  station: PoetStation
  index: number
  poems: Poem[]
}

/** Life stations with the author's works attached to the stage they fall in. */
export function poetStages(poet: PoetProfile, corpus: Poem[]): TrailStage[] {
  const works = poemsByAuthor(poet.name, corpus)
  const stages = poet.stations.map((station, index) => ({ station, index, poems: [] as Poem[] }))
  for (const poem of works) stages[stationIndexForPoem(poet, poem)]?.poems.push(poem)
  return stages
}

export interface PoetTrailFeatures {
  line: GeoJSON.Feature<GeoJSON.LineString>
  bounds: [[number, number], [number, number]]
}

/** The travelled line (station to station) and the box that holds it with the works. */
export function poetTrail(poet: PoetProfile, works: Poem[]): PoetTrailFeatures {
  const coordinates = poet.stations.map((station) => [station.longitude, station.latitude])
  const points = [...coordinates, ...works.map((poem) => [poem.longitude, poem.latitude])]
  const longitudes = points.map(([longitude]) => longitude)
  const latitudes = points.map(([, latitude]) => latitude)
  return {
    line: {
      type: 'Feature',
      properties: { poet: poet.name },
      geometry: { type: 'LineString', coordinates },
    },
    bounds: [
      [Math.min(...longitudes), Math.min(...latitudes)],
      [Math.max(...longitudes), Math.max(...latitudes)],
    ],
  }
}

/** Companions that are themselves on the map, in the order the profile lists them. */
export function companionsOf(poet: PoetProfile) {
  return (poet.companions ?? [])
    .map((name) => poetByName.get(name))
    .filter((companion): companion is PoetProfile => Boolean(companion))
}

/** Rough span of a life in kilometres travelled, for a one-line summary. */
export function trailLengthKm(poet: PoetProfile) {
  return poet.stations.reduce((total, station, index) =>
    index === 0 ? 0 : total + distanceKm(poet.stations[index - 1], station), 0)
}
