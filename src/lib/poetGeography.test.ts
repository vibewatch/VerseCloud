import { describe, expect, it } from 'vitest'
import { poems } from '../data/poems'
import { poetByName } from '../data/poets'
import {
  ageAtPoem,
  companionsOf,
  distanceKm,
  poemsByAuthor,
  poetStages,
  poetTrail,
  samePlacePoems,
  stationIndexForPoem,
  trailLengthKm,
} from './poetGeography'

const duFu = poetByName.get('杜甫')!
const chunWang = poems.find((poem) => poem.id === 'du-fu-chun-wang')!

describe('poet geography', () => {
  it('measures great-circle distance in kilometres', () => {
    const changan = { longitude: 108.94, latitude: 34.26 }
    const luoyang = { longitude: 112.45, latitude: 34.62 }
    expect(distanceKm(changan, changan)).toBe(0)
    expect(distanceKm(changan, luoyang)).toBeGreaterThan(310)
    expect(distanceKm(changan, luoyang)).toBeLessThan(340)
  })

  it('places a dated poem at its author’s age and life station', () => {
    expect(ageAtPoem(duFu, chunWang)).toBe(chunWang.year - duFu.birthYear)
    expect(ageAtPoem(duFu, { year: chunWang.year, datePrecision: 'period' })).toBeUndefined()
    const station = duFu.stations[stationIndexForPoem(duFu, chunWang)]
    expect(station.year).toBeLessThanOrEqual(chunWang.year)
  })

  it('attaches every work of the author to exactly one stage', () => {
    const works = poemsByAuthor('杜甫', poems)
    const stages = poetStages(duFu, poems)
    expect(stages).toHaveLength(duFu.stations.length)
    expect(stages.flatMap((stage) => stage.poems).map((poem) => poem.id).sort())
      .toEqual(works.map((poem) => poem.id).sort())
  })

  it('frames the travelled line together with the works', () => {
    const works = poemsByAuthor('杜甫', poems)
    const { line, bounds } = poetTrail(duFu, works)
    expect(line.geometry.coordinates).toHaveLength(duFu.stations.length)
    for (const poem of works) {
      expect(poem.longitude).toBeGreaterThanOrEqual(bounds[0][0])
      expect(poem.longitude).toBeLessThanOrEqual(bounds[1][0])
      expect(poem.latitude).toBeGreaterThanOrEqual(bounds[0][1])
      expect(poem.latitude).toBeLessThanOrEqual(bounds[1][1])
    }
    expect(trailLengthKm(duFu)).toBeGreaterThan(2000)
  })

  it('finds other hands at the same place, across dynasties', () => {
    const neighbours = samePlacePoems(chunWang, poems)
    expect(neighbours.every((poem) => poem.id !== chunWang.id)).toBe(true)
    expect(neighbours.every((poem) =>
      poem.placeId === chunWang.placeId || distanceKm(poem, chunWang) <= 12)).toBe(true)
    expect(new Set(neighbours.map((poem) => poem.dynasty)).size).toBeGreaterThan(1)
  })

  it('resolves companions to profiles', () => {
    expect(companionsOf(duFu).map((poet) => poet.name)).toContain('李白')
  })
})
