export type DynastyId =
  | 'pre-qin'
  | 'han'
  | 'wei-jin'
  | 'southern-northern'
  | 'sui'
  | 'tang'
  | 'five-dynasties'
  | 'song'
  | 'yuan'
  | 'ming'
  | 'qing'

export type PlaceRelation =
  | 'composed_at'
  | 'setting'
  | 'mentioned'
  | 'route'
  | 'associated'

export type Confidence = 'high' | 'medium' | 'low'

export type DatePrecision = 'exact' | 'circa' | 'range' | 'period' | 'disputed'

export type SchoolLevel = 'primary' | 'middle'

export type PoemVisualEffect =
  | 'petals-embers'
  | 'river-flight'
  | 'moon-fire'
  | 'river-mist'
  | 'sun-river'
  | 'cloud-crane'
  | 'waterfall'
  | 'morning-rain'

export interface Poem {
  id: string
  title: string
  author: string
  dynasty: DynastyId
  year: number
  yearLabel: string
  eraLabel: string
  datePrecision: DatePrecision
  dateEvidence: string
  lines: string[]
  longitude: number
  latitude: number
  placeId: string
  placeName: string
  relation: PlaceRelation
  confidence: Confidence
  evidence: string
  sourceLabel: string
  sourceUrl: string
  accent: string
  visualEffect: PoemVisualEffect
  visualEffectLabel: string
  curriculumLevels?: SchoolLevel[]
}

export interface GeoPlace {
  placeName: string
  longitude: number
  latitude: number
}

/**
 * One documented stop in a poet's life. Stations are ordered by `year` and
 * describe where the person was, not where every poem was written; poems are
 * attached to stations by proximity at runtime.
 */
export interface PoetStation extends GeoPlace {
  year: number
  yearLabel: string
  event: string
}

export interface PoetProfile {
  id: string
  /** Must equal `Poem.author` for every work attributed to this person. */
  name: string
  dynasty: DynastyId
  styleName?: string
  epithet?: string
  birthYear: number
  deathYear: number
  lifeLabel: string
  hometown: GeoPlace
  summary: string
  stations: PoetStation[]
  companions?: string[]
}

export interface MapSnapshot {
  id: string
  dynasty: DynastyId
  dynastyLabel: string
  eraLabel: string
  year: number
  startYear: number
  endYear: number
  dateRange: string
  status: 'published' | 'planned'
  note: string
  boundary?: number[][][][]
}

export interface ScenePoint {
  x: number
  y: number
}

export interface SoundscapeMix {
  changan: number
  jiangnan: number
  frontier: number
  dominant: 'changan' | 'jiangnan' | 'frontier'
}
