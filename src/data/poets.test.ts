import { describe, expect, it } from 'vitest'
import { poems } from './poems'
import { poetByName, poets } from './poets'

const authors = new Set(poems.map((poem) => poem.author))

describe('poet profiles', () => {
  it('uses unique ids and names that match attributed poems', () => {
    expect(new Set(poets.map((poet) => poet.id)).size).toBe(poets.length)
    expect(poetByName.size).toBe(poets.length)
    const orphans = poets.filter((poet) => !authors.has(poet.name)).map((poet) => poet.name)
    expect(orphans).toEqual([])
  })

  it('keeps life stations in order, inside the life and on the map', () => {
    for (const poet of poets) {
      expect(poet.birthYear, poet.name).toBeLessThan(poet.deathYear)
      expect(poet.stations.length, poet.name).toBeGreaterThanOrEqual(2)
      poet.stations.forEach((station, index) => {
        expect(Number.isInteger(station.year), `${poet.name} ${station.placeName}`).toBe(true)
        expect(station.year, `${poet.name} ${station.placeName}`).toBeGreaterThanOrEqual(poet.birthYear)
        expect(station.year, `${poet.name} ${station.placeName}`).toBeLessThanOrEqual(poet.deathYear)
        if (index > 0) {
          expect(station.year, `${poet.name} ${station.placeName}`)
            .toBeGreaterThanOrEqual(poet.stations[index - 1].year)
        }
        expect(station.longitude).toBeGreaterThan(70)
        expect(station.longitude).toBeLessThan(135)
        expect(station.latitude).toBeGreaterThan(15)
        expect(station.latitude).toBeLessThan(55)
      })
    }
  })

  it('dates every profiled poem within its author’s lifetime', () => {
    const outside = poems
      .filter((poem) => {
        const poet = poetByName.get(poem.author)
        return poet && (poem.year < poet.birthYear || poem.year > poet.deathYear)
      })
      .map((poem) => `${poem.author}《${poem.title}》${poem.year}`)
    expect(outside).toEqual([])
  })

  it('only names companions who are profiled and never themselves', () => {
    for (const poet of poets) {
      for (const name of poet.companions ?? []) {
        expect(name, poet.name).not.toBe(poet.name)
        expect(poetByName.has(name), `${poet.name} → ${name}`).toBe(true)
      }
    }
  })
})
