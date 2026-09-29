import {
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef } from 'react'
import {
  historicalDivisionCollection,
  historicalMapContexts,
  type HistoricalMapContext,
} from '../data/historicalGeography'
import { dynastyLabels } from '../data/mapSnapshots'
import { projectPoint } from '../lib/geo'
import { distanceKm, poemsByAuthor, poetTrail } from '../lib/poetGeography'
import { groupPoemsByPlace, type PoemPlaceGroup } from '../lib/poemPlaces'
import { emptyPoemRoute, poemRoute } from '../lib/poemRoute'
import type { DynastyId, GeoPlace, Poem, PoetProfile, PoetStation, ScenePoint } from '../types'

interface VerseSceneProps {
  poems: Poem[]
  selectedPoem: Poem
  onSelectPoem: (poem: Poem) => void
  onFocusChange: (point: ScenePoint) => void
  /** The person whose documented life stations are drawn over the map. */
  trailPoet?: PoetProfile | null
  /** While folded the verse slip shrinks to a tab so the whole trail reads. */
  trailFolded?: boolean
  onUnfold?: () => void
}

type LineLayerSpecification = Extract<StyleSpecification['layers'][number], { type: 'line' }>
type LineGradientSpecification = NonNullable<
  NonNullable<LineLayerSpecification['paint']>['line-gradient']
>

// Vite does not discover MapLibre's import.meta.url worker when the library is
// loaded lazily. Importing it as an asset makes the production URL explicit.
setWorkerUrl(mapWorkerUrl)

const classicalChinaBounds: [[number, number], [number, number]] = [
  [68, 10],
  [131, 53],
]

const geographicStyle: StyleSpecification = {
  version: 8,
  name: 'VerseCloud geographic relief',
  sources: {
    shadedRelief: {
      type: 'raster',
      tiles: ['https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 6,
      bounds: [69, 18, 129, 51],
      attribution: 'Natural Earth · OpenFreeMap',
    },
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution: '© OpenFreeMap · © OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'night-paper',
      type: 'background',
      paint: { 'background-color': '#09130f' },
    },
    {
      id: 'earth-relief',
      type: 'raster',
      source: 'shadedRelief',
      paint: {
        'raster-opacity': 0.86,
        'raster-fade-duration': 180,
        'raster-saturation': -0.48,
        'raster-contrast': 0.28,
        'raster-brightness-min': 0.04,
        'raster-brightness-max': 0.46,
        'raster-hue-rotate': 18,
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: {
        'fill-color': [
          'match',
          ['get', 'class'],
          'ocean', '#071f25',
          'lake', '#123239',
          'river', '#1a4143',
          '#0d2c31',
        ],
        'fill-opacity': 0.9,
      },
    },
    {
      id: 'rivers',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      filter: ['in', 'class', 'river', 'canal'],
      paint: {
        'line-color': [
          'match',
          ['get', 'class'],
          'canal', '#a4bba3',
          '#73aaa5',
        ],
        'line-opacity': 0.4,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.4, 7, 1.8],
      },
    },
  ],
  sky: {
    'sky-color': '#07110d',
    'horizon-color': '#2d3b32',
    'fog-color': '#101d17',
    'sky-horizon-blend': 0.72,
    'horizon-fog-blend': 0.42,
    'fog-ground-blend': 0.6,
    'atmosphere-blend': 0.5,
  },
}

function historicalLabelCollection(
  context: HistoricalMapContext,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: context.labels.map((label, index) => ({
      type: 'Feature',
      id: index,
      properties: {
        imageId: `historical-label-${context.dynasty}-${index}`,
        kind: label.kind,
        major: Boolean(label.major),
      },
      geometry: {
        type: 'Point',
        coordinates: [label.longitude, label.latitude],
      },
    })),
  }
}

function createLabelImage(name: string, kind: 'region' | 'prefecture') {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const fontSize = kind === 'region' ? 13 : 12
  const letterSpacing = kind === 'region' ? 6 : 1.5
  const paddingX = kind === 'region' ? 7 : 5
  const dotWidth = kind === 'prefecture' ? 8 : 0
  const measureCanvas = document.createElement('canvas')
  const measure = measureCanvas.getContext('2d')
  if (!measure) return null
  measure.font = `${fontSize}px "Zhuque Fangsong (technical preview)", FangSong, serif`
  const textWidth = measure.measureText(name).width + Math.max(0, name.length - 1) * letterSpacing
  const width = Math.ceil(textWidth + paddingX * 2 + dotWidth)
  const height = kind === 'region' ? 24 : 21
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * pixelRatio)
  canvas.height = Math.ceil(height * pixelRatio)
  const context = canvas.getContext('2d')
  if (!context) return null
  context.scale(pixelRatio, pixelRatio)
  context.font = `${fontSize}px "Zhuque Fangsong (technical preview)", FangSong, serif`
  context.textBaseline = 'middle'
  context.shadowColor = 'rgba(2, 8, 6, 0.95)'
  context.shadowBlur = kind === 'region' ? 6 : 4

  if (kind === 'region') {
    // Regions read as a quiet engraved layer beneath the poems: spaced type
    // on the relief, no frame competing with the poem markers.
    context.fillStyle = 'rgba(214, 192, 142, 0.62)'
  } else {
    context.fillStyle = 'rgba(203, 174, 105, 0.9)'
    context.beginPath()
    context.arc(4, height / 2, 2, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = 'rgba(238, 226, 197, 0.88)'
  }

  let x = paddingX + dotWidth
  for (const character of name) {
    context.fillText(character, x, height / 2 + 0.5)
    x += context.measureText(character).width + letterSpacing
  }
  return { image: context.getImageData(0, 0, canvas.width, canvas.height), pixelRatio }
}

const poemMarkerHeadCenterY = 12
// Every place stands at one height. Density is handled by clustering, so the
// stems no longer need to be raised in tiers to stay apart.
const poemMarkerHeight = 36

type PoemMarkerTone = 'idle' | 'selected' | 'trail'

const markerTones: Record<PoemMarkerTone, {
  stemTop: string
  stemBottom: string
  foot: string
  fill: string
  stroke: string
  ink: string
  width: number
}> = {
  idle: {
    stemTop: '#c8b27f',
    stemBottom: '#5f604f',
    foot: 'rgba(183, 169, 126, 0.72)',
    fill: 'rgba(16, 29, 24, 0.9)',
    stroke: 'rgba(220, 202, 158, 0.9)',
    ink: 'rgba(208, 190, 148, 0.72)',
    width: 1.25,
  },
  selected: {
    stemTop: '#f1d49a',
    stemBottom: '#8f6540',
    foot: '#d4a866',
    fill: 'rgba(139, 65, 48, 0.96)',
    stroke: '#f0d59c',
    ink: '#f9e7ba',
    width: 1.8,
  },
  trail: {
    stemTop: '#a9d4c8',
    stemBottom: '#3f6a60',
    foot: 'rgba(143, 196, 182, 0.86)',
    fill: 'rgba(22, 56, 49, 0.94)',
    stroke: '#a9d4c8',
    ink: '#d9efe8',
    width: 1.5,
  },
}

function createPoemLabelImage(name: string) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const fontSize = 15
  const letterSpacing = 1
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null
  context.font = `${fontSize}px "Zhuque Fangsong (technical preview)", FangSong, serif`
  const textWidth = context.measureText(name).width + Math.max(0, name.length - 1) * letterSpacing
  const width = Math.ceil(textWidth + 14)
  const height = 28
  canvas.width = Math.ceil(width * pixelRatio)
  canvas.height = Math.ceil(height * pixelRatio)
  const paint = canvas.getContext('2d')
  if (!paint) return null
  paint.scale(pixelRatio, pixelRatio)
  paint.font = `${fontSize}px "Zhuque Fangsong (technical preview)", FangSong, serif`
  paint.textBaseline = 'middle'
  paint.fillStyle = '#f3e5c5'
  paint.shadowColor = 'rgba(2, 8, 6, 0.98)'
  paint.shadowBlur = 5
  let x = 7
  for (const character of name) {
    paint.fillText(character, x, height / 2)
    x += paint.measureText(character).width + letterSpacing
  }
  return { image: paint.getImageData(0, 0, canvas.width, canvas.height), pixelRatio }
}

function createPoemCountImage(count: number, variant: 'badge' | 'cluster') {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const size = variant === 'cluster' ? 30 : 22
  const canvas = document.createElement('canvas')
  canvas.width = size * pixelRatio
  canvas.height = size * pixelRatio
  const context = canvas.getContext('2d')
  if (!context) return null
  context.scale(pixelRatio, pixelRatio)
  context.font = variant === 'cluster'
    ? '600 13px "Zhuque Fangsong (technical preview)", FangSong, serif'
    : '600 10px "Zhuque Fangsong (technical preview)", FangSong, serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.shadowColor = 'rgba(2, 7, 5, 0.9)'
  context.shadowBlur = 2
  context.fillStyle = variant === 'cluster' ? '#f1ddb0' : '#f3dfb1'
  context.fillText(String(count), size / 2, size / 2 - (variant === 'cluster' ? 0 : 1))
  return { image: context.getImageData(0, 0, canvas.width, canvas.height), pixelRatio }
}

function createPoemMarkerImage(tone: PoemMarkerTone) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const palette = markerTones[tone]
  const emphasised = tone !== 'idle'
  const width = 40
  const height = poemMarkerHeight
  const canvas = document.createElement('canvas')
  canvas.width = width * pixelRatio
  canvas.height = height * pixelRatio
  const context = canvas.getContext('2d')
  if (!context) return null
  context.scale(pixelRatio, pixelRatio)

  const centerX = width / 2
  const headWidth = emphasised ? 16 : 14
  const headHeight = emphasised ? 22 : 20
  const headX = centerX - headWidth / 2
  const headY = poemMarkerHeadCenterY - headHeight / 2
  const baseY = height - 3

  context.lineCap = 'round'
  context.strokeStyle = 'rgba(1, 5, 3, 0.72)'
  context.lineWidth = 3
  context.beginPath()
  context.moveTo(centerX + 1, headY + headHeight - 1)
  context.lineTo(centerX + 1, baseY - 3)
  context.stroke()

  const stem = context.createLinearGradient(centerX, headY, centerX, baseY)
  stem.addColorStop(0, palette.stemTop)
  stem.addColorStop(1, palette.stemBottom)
  context.strokeStyle = stem
  context.lineWidth = emphasised ? 1.8 : 1.2
  context.beginPath()
  context.moveTo(centerX, headY + headHeight - 1)
  context.lineTo(centerX, baseY - 3)
  context.stroke()

  context.strokeStyle = palette.foot
  context.lineWidth = emphasised ? 1.8 : 1.2
  context.beginPath()
  context.moveTo(centerX - 6, baseY - 3)
  context.lineTo(centerX, baseY)
  context.lineTo(centerX + 6, baseY - 3)
  context.stroke()

  const corner = 3
  context.beginPath()
  context.moveTo(headX + corner, headY)
  context.lineTo(headX + headWidth - corner, headY)
  context.lineTo(headX + headWidth, headY + corner)
  context.lineTo(headX + headWidth, headY + headHeight - corner)
  context.lineTo(headX + headWidth - corner, headY + headHeight)
  context.lineTo(headX + corner, headY + headHeight)
  context.lineTo(headX, headY + headHeight - corner)
  context.lineTo(headX, headY + corner)
  context.closePath()
  context.fillStyle = palette.fill
  context.strokeStyle = palette.stroke
  context.lineWidth = palette.width
  context.fill()
  context.stroke()

  context.strokeStyle = palette.ink
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(centerX - 3, poemMarkerHeadCenterY - 3)
  context.lineTo(centerX + 3, poemMarkerHeadCenterY - 3)
  context.moveTo(centerX - 3, poemMarkerHeadCenterY + 1)
  context.lineTo(centerX + 3, poemMarkerHeadCenterY + 1)
  context.stroke()

  context.fillStyle = palette.ink
  context.beginPath()
  context.arc(centerX, poemMarkerHeadCenterY + 6, 1.1, 0, Math.PI * 2)
  context.fill()

  return { image: context.getImageData(0, 0, canvas.width, canvas.height), pixelRatio }
}

function routeInkGradient(progress: number): LineGradientSpecification {
  return [
    'case',
    ['<=', ['line-progress'], progress],
    'rgba(205, 184, 132, 0.58)',
    'rgba(205, 184, 132, 0)',
  ] as LineGradientSpecification
}

function routeFlowGradient(progress: number): LineGradientSpecification {
  const head = Math.min(0.985, Math.max(0.015, progress))
  const tail = Math.max(0, head - 0.2)
  const shoulder = Math.max(tail + 0.001, head - 0.055)
  return [
    'interpolate', ['linear'], ['line-progress'],
    tail, 'rgba(217, 181, 100, 0)',
    shoulder, 'rgba(222, 188, 111, 0.5)',
    head, 'rgba(255, 239, 190, 1)',
    head + 0.025, 'rgba(255, 239, 190, 0)',
  ] as LineGradientSpecification
}

const transparentRouteGradient = [
  'case',
  ['>=', ['line-progress'], 0],
  'rgba(255, 239, 190, 0)',
  'rgba(255, 239, 190, 0)',
] as LineGradientSpecification

interface PoemSceneFocus {
  selectedPoemId: string
  trailAuthor?: string
}

function placeFeature(
  group: PoemPlaceGroup,
  focus: PoemSceneFocus,
): GeoJSON.Feature<GeoJSON.Point> {
  const selected = group.poems.some((poem) => poem.id === focus.selectedPoemId)
  const onTrail = Boolean(focus.trailAuthor)
    && group.poems.some((poem) => poem.author === focus.trailAuthor)
  const tone: PoemMarkerTone = selected ? 'selected' : onTrail ? 'trail' : 'idle'
  const representative = group.poems.find((poem) => poem.id === focus.selectedPoemId)
    ?? group.poems.find((poem) => poem.author === focus.trailAuthor)
    ?? group.poems[0]
  return {
    type: 'Feature',
    properties: {
      key: group.key,
      id: representative.id,
      title: representative.title,
      author: representative.author,
      placeName: group.placeName,
      imageId: `poem-label-${group.key}`,
      markerImageId: `poem-marker-${tone}`,
      countImageId: `poem-count-${group.poems.length}`,
      memberIds: JSON.stringify(group.poems.map((poem) => poem.id)),
      count: group.poems.length,
      tone,
      selected,
    },
    geometry: {
      type: 'Point',
      coordinates: [group.longitude, group.latitude],
    },
  }
}

/**
 * Places split into two sources: the quiet remainder clusters into seals as
 * the reader zooms out, while the selected place and the places of the person
 * being followed stay individually readable above them.
 */
function poemSourceData(groups: PoemPlaceGroup[], focus: PoemSceneFocus) {
  const clustered: GeoJSON.Feature<GeoJSON.Point>[] = []
  const focused: GeoJSON.Feature<GeoJSON.Point>[] = []
  groups.forEach((group) => {
    const feature = placeFeature(group, focus)
    if (feature.properties?.tone === 'idle') clustered.push(feature)
    else focused.push(feature)
  })
  return {
    clustered: { type: 'FeatureCollection', features: clustered } as GeoJSON.FeatureCollection,
    focused: { type: 'FeatureCollection', features: focused } as GeoJSON.FeatureCollection,
  }
}

function refreshPoemSources(map: MapLibreMap, groups: PoemPlaceGroup[], focus: PoemSceneFocus) {
  const data = poemSourceData(groups, focus)
  ;(map.getSource('poems') as GeoJSONSource | undefined)?.setData(data.clustered)
  ;(map.getSource('poem-focus') as GeoJSONSource | undefined)?.setData(data.focused)
}

const emptyTrail: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function addHistoricalLayers(
  map: MapLibreMap,
  groups: PoemPlaceGroup[],
  focus: PoemSceneFocus,
  context: HistoricalMapContext,
) {
  map.addSource('historical-regions', {
    type: 'geojson',
    data: historicalDivisionCollection(context),
  })
  map.addLayer({
    id: 'historical-region-line',
    type: 'line',
    source: 'historical-regions',
    paint: {
      'line-color': '#c5af7d',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.28, 6, 0.5],
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.55, 6, 1.15],
      'line-dasharray': [1.2, 2.4],
    },
  })

  // A person's documented life path, drawn in jade so it never reads as the
  // gold ink of the journey between two selected poems.
  map.addSource('poet-trail', { type: 'geojson', data: emptyTrail })
  map.addLayer({
    id: 'poet-trail-shadow',
    type: 'line',
    source: 'poet-trail',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#040b08',
      'line-opacity': 0.55,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 4, 7, 7],
      'line-blur': 2,
    },
  })
  map.addLayer({
    id: 'poet-trail-line',
    type: 'line',
    source: 'poet-trail',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#93c7b9',
      'line-opacity': 0.92,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.4, 7, 2.4],
      'line-dasharray': [2.2, 1.6],
    },
  })

  map.addSource('poem-route', {
    type: 'geojson',
    data: emptyPoemRoute(),
    lineMetrics: true,
  })
  map.addLayer({
    id: 'poem-route-shadow',
    type: 'line',
    source: 'poem-route',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#07100d',
      'line-opacity': 0.46,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3.2, 7, 5.4],
      'line-blur': 1.2,
    },
  })
  map.addLayer({
    id: 'poem-route-ink',
    type: 'line',
    source: 'poem-route',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-gradient': routeInkGradient(0),
      'line-opacity': 0.74,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.1, 7, 1.8],
    },
  })
  map.addLayer({
    id: 'poem-route-flow',
    type: 'line',
    source: 'poem-route',
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-gradient': transparentRouteGradient,
      'line-opacity': 0.92,
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.8, 7, 4.5],
      'line-blur': 0.7,
    },
  })

  const data = poemSourceData(groups, focus)
  map.addSource('poems', {
    type: 'geojson',
    data: data.clustered,
    cluster: true,
    clusterRadius: 42,
    // Equal to the camera's maximum zoom: sites a few li apart inside one
    // capital stay sealed together and open as a list instead of overlapping.
    clusterMaxZoom: 8,
    clusterProperties: { poemCount: ['+', ['get', 'count']] },
  })
  map.addSource('poem-focus', { type: 'geojson', data: data.focused })
  map.addLayer({
    id: 'poem-cluster-halo',
    type: 'circle',
    source: 'poems',
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'poemCount'], 18, 6, 21, 16, 24, 40, 28],
      'circle-color': 'rgba(0, 0, 0, 0)',
      'circle-stroke-color': '#d6c292',
      'circle-stroke-width': 0.8,
      'circle-stroke-opacity': 0.3,
      'circle-pitch-alignment': 'viewport',
    },
  })
  map.addLayer({
    id: 'poem-clusters',
    type: 'circle',
    source: 'poems',
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'poemCount'], 13, 6, 16, 16, 19, 40, 23],
      'circle-color': '#0d1a15',
      'circle-opacity': 0.88,
      'circle-stroke-color': '#dcc898',
      'circle-stroke-width': 1.2,
      'circle-stroke-opacity': 0.78,
      'circle-pitch-alignment': 'viewport',
    },
  })
}

// Base opacities of the layers that recede while a life trail is shown.
const trailDimmedLayers: Array<[string, string, number, number]> = [
  ['poem-cluster-halo', 'circle-stroke-opacity', 0.3, 0.12],
  ['poem-clusters', 'circle-opacity', 0.88, 0.42],
  ['poem-clusters', 'circle-stroke-opacity', 0.78, 0.26],
  ['poem-cluster-count', 'icon-opacity', 1, 0.38],
  ['poem-location-markers', 'icon-opacity', 1, 0.34],
  ['poem-count-badges', 'icon-opacity', 1, 0.34],
  ['poem-place-labels', 'icon-opacity', 0.82, 0.2],
  ['historical-prefecture-labels', 'icon-opacity', 0.8, 0.4],
]

function applyTrailDimming(map: MapLibreMap, active: boolean) {
  trailDimmedLayers.forEach(([layer, property, base, dimmed]) => {
    if (!map.getLayer(layer)) return
    map.setPaintProperty(layer, property as 'circle-opacity', active ? dimmed : base)
  })
}

/** Name images for one period's places and regions; drawn once, then reused. */
function addPeriodLabelImages(
  map: MapLibreMap,
  groups: PoemPlaceGroup[],
  context: HistoricalMapContext,
) {
  context.labels.forEach((label, index) => {
    const id = `historical-label-${context.dynasty}-${index}`
    if (map.hasImage(id)) return
    const rendered = createLabelImage(label.name, label.kind)
    if (rendered) map.addImage(id, rendered.image, { pixelRatio: rendered.pixelRatio })
  })
  groups.forEach((group) => {
    const id = `poem-label-${group.key}`
    if (map.hasImage(id)) return
    const rendered = createPoemLabelImage(group.placeName)
    if (rendered) map.addImage(id, rendered.image, { pixelRatio: rendered.pixelRatio })
  })
}

function describePeriod(
  container: HTMLElement,
  dynasty: DynastyId,
  context: HistoricalMapContext,
  groups: PoemPlaceGroup[],
) {
  container.setAttribute('data-dynasty', dynasty)
  container.setAttribute('data-history-layer', `${dynasty}-administrative-context`)
  container.setAttribute('data-administrative-system', context.systemLabel)
  container.setAttribute('data-administrative-reference', context.referenceLabel)
  container.setAttribute(
    'data-administrative-region-count',
    String(context.labels.filter((label) => label.kind === 'region').length),
  )
  container.setAttribute(
    'data-poem-place-groups',
    JSON.stringify(groups.map((group) => ({
      key: group.key,
      count: group.poems.length,
      markerHeight: poemMarkerHeight,
      poemIds: group.poems.map((poem) => poem.id),
    }))),
  )
}

async function addWebglLabelLayers(
  map: MapLibreMap,
  container: HTMLElement,
  currentPeriod: () => { groups: PoemPlaceGroup[]; context: HistoricalMapContext },
  isTrailActive: () => boolean,
) {
  await document.fonts.ready
  try {
    if (!map.getSource('poems')) return
  } catch {
    return
  }

  // The reader may have changed period while the fonts loaded.
  const { groups, context } = currentPeriod()
  addPeriodLabelImages(map, groups, context)
  const tones: PoemMarkerTone[] = ['idle', 'selected', 'trail']
  tones.forEach((tone) => {
    const id = `poem-marker-${tone}`
    if (map.hasImage(id)) return
    const rendered = createPoemMarkerImage(tone)
    if (rendered) map.addImage(id, rendered.image, { pixelRatio: rendered.pixelRatio })
  })
  map.addSource('historical-labels', {
    type: 'geojson',
    data: historicalLabelCollection(context),
  })
  map.addLayer({
    id: 'historical-region-labels',
    type: 'symbol',
    source: 'historical-labels',
    maxzoom: 4.75,
    filter: ['==', ['get', 'kind'], 'region'],
    layout: {
      'icon-image': ['get', 'imageId'],
      'icon-allow-overlap': false,
      'icon-padding': 5,
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
    },
    paint: {
      'icon-opacity': ['case', ['get', 'major'], 0.9, 0.62],
    },
  }, 'poem-cluster-halo')
  map.addLayer({
    id: 'historical-prefecture-labels',
    type: 'symbol',
    source: 'historical-labels',
    minzoom: 4.25,
    filter: ['==', ['get', 'kind'], 'prefecture'],
    layout: {
      'icon-image': ['get', 'imageId'],
      'icon-allow-overlap': false,
      'icon-padding': 4,
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
    },
    paint: {
      'icon-opacity': 0.8,
    },
  }, 'poem-cluster-halo')
  map.addLayer({
    id: 'poem-cluster-count',
    type: 'symbol',
    source: 'poems',
    filter: ['has', 'point_count'],
    layout: {
      'icon-image': ['concat', 'cluster-count-', ['to-string', ['get', 'poemCount']]],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
    },
  })

  const markerLayout = {
    'icon-image': ['get', 'markerImageId'],
    'icon-anchor': 'bottom',
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
    'icon-pitch-alignment': 'viewport',
    'icon-rotation-alignment': 'viewport',
  } as const
  const countLayout = {
    'icon-image': ['get', 'countImageId'],
    'icon-anchor': 'bottom',
    'icon-offset': [0, -poemMarkerHeight + 23],
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
    'icon-pitch-alignment': 'viewport',
    'icon-rotation-alignment': 'viewport',
  } as const
  const labelLayout = {
    'icon-image': ['get', 'imageId'],
    'icon-anchor': 'bottom',
    'icon-offset': [0, -poemMarkerHeight - 4],
    'icon-allow-overlap': false,
    'icon-ignore-placement': false,
    'icon-padding': 7,
    'icon-pitch-alignment': 'viewport',
    'icon-rotation-alignment': 'viewport',
  } as const
  const single = ['!', ['has', 'point_count']] as const

  map.addLayer({
    id: 'poem-location-markers',
    type: 'symbol',
    source: 'poems',
    filter: single as never,
    layout: markerLayout as never,
  })
  map.addLayer({
    id: 'poem-count-badges',
    type: 'symbol',
    source: 'poems',
    filter: ['all', single, ['>', ['get', 'count'], 1]] as never,
    layout: countLayout as never,
  })
  map.addLayer({
    id: 'poem-place-labels',
    type: 'symbol',
    source: 'poems',
    minzoom: 3.3,
    filter: single as never,
    layout: labelLayout as never,
    paint: { 'icon-opacity': 0.82 },
  })
  map.addLayer({
    id: 'poem-focus-markers',
    type: 'symbol',
    source: 'poem-focus',
    layout: {
      ...markerLayout,
      'icon-size': ['case', ['get', 'selected'], 1.08, 1],
      'symbol-sort-key': ['case', ['get', 'selected'], 1, 0],
    } as never,
  })
  map.addLayer({
    id: 'poem-focus-counts',
    type: 'symbol',
    source: 'poem-focus',
    filter: ['>', ['get', 'count'], 1],
    layout: countLayout as never,
  })
  map.addLayer({
    id: 'poem-focus-labels',
    type: 'symbol',
    source: 'poem-focus',
    // A framed life is named by its numbered stations; the works' own place
    // names join once the reader zooms into a stretch of the route.
    minzoom: 5.4,
    filter: ['==', ['get', 'selected'], false],
    layout: labelLayout as never,
    paint: { 'icon-opacity': 0.94 },
  })
  map.addLayer({
    id: 'poem-selected-place-label',
    type: 'symbol',
    source: 'poem-focus',
    minzoom: 3.3,
    filter: ['==', ['get', 'selected'], true],
    layout: {
      ...labelLayout,
      'icon-size': 1.14,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-padding': 3,
    } as never,
  })
  applyTrailDimming(map, isTrailActive())
  container.setAttribute('data-poem-density-policy', 'clustered')
  container.setAttribute('data-history-ready', 'true')
}

interface TrailStop {
  station: PoetStation
  numbers: number[]
  home: boolean
}

function trailStopNumbers(numbers: number[]) {
  return numbers.length <= 3
    ? numbers.join('·')
    : `${numbers[0]}…${numbers[numbers.length - 1]}`
}

/**
 * Numbered seals for each documented stop in a life. Revisits merge into one
 * seal ("2·5") and only the first of several nearby stops keeps its name, so
 * a life spent between 长安 and 洛阳 does not bury the map in labels.
 */
function createTrailMarkers(poet: PoetProfile) {
  const stops: TrailStop[] = []
  poet.stations.forEach((station, index) => {
    const stop = stops.find((candidate) => distanceKm(candidate.station, station) <= 8)
    if (stop) stop.numbers.push(index + 1)
    else stops.push({ station, numbers: [index + 1], home: false })
  })
  const homeStop = stops.find((stop) => distanceKm(stop.station, poet.hometown) <= 8)
  if (homeStop) homeStop.home = true

  const named: GeoPlace[] = []
  const markers = stops.map((stop) => {
    const crowded = named.some((place) => distanceKm(place, stop.station) < 70)
    if (!crowded) named.push(stop.station)
    const element = document.createElement('div')
    element.className = [
      'trail-station',
      stop.home ? 'is-home' : '',
      crowded ? 'is-crowded' : '',
    ].filter(Boolean).join(' ')
    element.title = stop.numbers.map((number) => {
      const station = poet.stations[number - 1]
      return `${station.yearLabel} · ${station.placeName} · ${station.event}`
    }).join('\n')
    const seal = document.createElement('b')
    seal.textContent = trailStopNumbers(stop.numbers)
    const name = document.createElement('span')
    name.textContent = stop.home ? `${stop.station.placeName} · 籍` : stop.station.placeName
    element.append(seal, name)
    return new Marker({ element, anchor: 'center' })
      .setLngLat([stop.station.longitude, stop.station.latitude])
  })

  if (!homeStop) {
    const element = document.createElement('div')
    element.className = 'trail-station is-home is-origin'
    element.title = `籍贯 · ${poet.hometown.placeName}`
    const seal = document.createElement('b')
    seal.textContent = '籍'
    const name = document.createElement('span')
    name.textContent = poet.hometown.placeName
    element.append(seal, name)
    markers.unshift(new Marker({ element, anchor: 'center' })
      .setLngLat([poet.hometown.longitude, poet.hometown.latitude]))
  }
  return markers
}

function splitVerseSentences(lines: string[]) {
  return lines.flatMap((line) =>
    line.match(/[^，。！？；!?;]+[，。！？；!?;]?/gu)?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? [line],
  )
}

function balanceVerseColumns(sentences: string[], maximumColumns: number) {
  if (sentences.length <= maximumColumns) return sentences

  const columnCount = Math.max(1, maximumColumns)
  const remainingCharacters = sentences
    .map((sentence) => [...sentence].length)
    .reduce((sum, length) => sum + length, 0)
  const columns: string[] = []
  let sentenceIndex = 0
  let consumedCharacters = 0

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const columnsLeft = columnCount - columnIndex
    const targetLength = (remainingCharacters - consumedCharacters) / columnsLeft
    let column = ''
    let columnLength = 0

    while (sentenceIndex < sentences.length) {
      const sentence = sentences[sentenceIndex]
      const sentenceLength = [...sentence].length
      const sentencesLeftAfter = sentences.length - sentenceIndex - 1
      const mustLeaveOnePerColumn = sentencesLeftAfter < columnsLeft - 1
      if (column && (mustLeaveOnePerColumn || columnLength + sentenceLength > targetLength)) break
      column += sentence
      columnLength += sentenceLength
      sentenceIndex += 1
      if (sentences.length - sentenceIndex === columnsLeft - 1) break
    }

    columns.push(column)
    consumedCharacters += columnLength
  }

  return columns.filter(Boolean)
}

function compactVerticalLabel(value: string) {
  const compacted = value
    .replace(/\s*·\s*/gu, '·')
    .trim()
  return [...compacted].slice(0, 7).join('')
}

function fitVerticalText(
  value: string,
  columnHeight: number,
  maximumSize: number,
  letterSpacingEm: number,
) {
  const characters = Math.max(1, [...value].length)
  // Keep a small physical safety margin for CJK glyph ascenders, punctuation
  // and browser sub-pixel rounding in vertical writing mode.
  const fittedSize = (columnHeight
    / (characters + Math.max(0, characters - 1) * letterSpacingEm)) * 0.86
  return Math.min(maximumSize, fittedSize)
}

function sizeVerticalVerseMarker(element: HTMLElement, poem: Poem) {
  const compact = window.matchMedia('(max-width: 680px)').matches
  const sentences = splitVerseSentences(poem.lines)
  const maximumFontSize = compact ? 13 : 16
  const lineHeight = compact ? 1.32 : 1.45
  const columnGap = compact ? 4 : 6
  const signWidth = Math.min(
    compact ? window.innerWidth - 26 : 520,
    window.innerWidth - (compact ? 26 : 48),
  )
  // Padding, title, author, place label, dividers and the gaps between those
  // fixed columns. Keeping this separate from verse gaps makes the frame's
  // width deterministic instead of relying on flexbox to squeeze long ci.
  const fixedColumnsWidth = compact ? 88 : 122
  const preferredColumnWidth = maximumFontSize * lineHeight
  const maximumColumns = Math.max(
    1,
    Math.floor(
      (signWidth - fixedColumnsWidth + columnGap)
      / (preferredColumnWidth + columnGap),
    ),
  )
  const columns = balanceVerseColumns(sentences, maximumColumns)
  const longestSentence = Math.max(
    1,
    ...columns.map((column) => [...column].length),
  )
  const letterSpacingEm = compact ? 0.02 : 0.045
  const heightBudget = compact
    ? Math.min(320, Math.max(184, window.innerHeight * 0.38))
    : Math.min(380, Math.max(220, window.innerHeight * 0.42))
  const heightFit = heightBudget
    / (longestSentence + Math.max(0, longestSentence - 1) * letterSpacingEm)
  const verseGapsWidth = Math.max(0, columns.length - 1) * columnGap
  const widthFit = (signWidth - fixedColumnsWidth - verseGapsWidth)
    / Math.max(1, columns.length)
    / lineHeight
  const minimumFontSize = compact ? 9.5 : 11
  const fontSize = Math.min(
    maximumFontSize,
    Math.max(minimumFontSize, Math.min(heightFit, widthFit)),
  )
  // Chromium's vertical CJK glyph advance can exceed the nominal font size,
  // especially around rotated punctuation. Reserve measured headroom so a
  // final long column never clips even when the arithmetic character count fits.
  const columnHeight = fontSize
    * (longestSentence + Math.max(0, longestSentence - 1) * letterSpacingEm)
    * 1.1
  const titleSize = fitVerticalText(
    poem.title,
    columnHeight,
    compact ? Math.min(19, fontSize * 1.48) : Math.min(25, fontSize * 1.52),
    0.12,
  )
  const authorLabel = `${dynastyLabels[poem.dynasty]}·${poem.author}`
  const metaLabel = `${compactVerticalLabel(poem.placeName)}·${compactVerticalLabel(poem.visualEffectLabel)}`
  const authorSize = fitVerticalText(authorLabel, columnHeight, compact ? 9 : 12, 0.05)
  const metaSize = fitVerticalText(metaLabel, columnHeight, compact ? 8 : 10, 0.04)
  const frameWidth = Math.min(
    signWidth,
    fixedColumnsWidth + verseGapsWidth + columns.length * fontSize * lineHeight,
  )

  element.style.setProperty('--map-poem-font-size', `${fontSize.toFixed(2)}px`)
  element.style.setProperty('--map-poem-title-size', `${titleSize.toFixed(2)}px`)
  element.style.setProperty('--map-poem-author-size', `${authorSize.toFixed(2)}px`)
  element.style.setProperty('--map-poem-meta-size', `${metaSize.toFixed(2)}px`)
  // Leave a few physical pixels for font ascenders, punctuation and browser
  // sub-pixel rounding while keeping every item inside the same visual column.
  element.style.setProperty('--map-poem-column-height', `${(columnHeight + 3).toFixed(2)}px`)
  element.style.setProperty('--map-poem-frame-width', `${Math.ceil(frameWidth)}px`)
  element.dataset.sentenceCount = String(sentences.length)
  element.dataset.columnCount = String(columns.length)
  const lines = element.querySelector<HTMLElement>('.map-poem-lines')
  const layoutKey = columns.join('\n')
  if (lines && lines.dataset.layoutKey !== layoutKey) {
    lines.replaceChildren(...columns.map((column) => {
      const verseLine = document.createElement('p')
      verseLine.textContent = column
      return verseLine
    }))
    lines.dataset.layoutKey = layoutKey
  }
  delete element.dataset.baseWidth
  delete element.dataset.baseHeight
}

function scaleVerticalVerseMarker(element: HTMLElement, map: MapLibreMap) {
  const compact = window.matchMedia('(max-width: 680px)').matches
  const zoomRange = Math.max(0.01, map.getMaxZoom() - map.getMinZoom())
  const progress = Math.min(
    1,
    Math.max(0, (map.getZoom() - map.getMinZoom()) / zoomRange),
  )
  const desiredScale = 1 + progress * (compact ? 0.3 : 0.42)
  const baseWidth = Number(element.dataset.baseWidth) || element.offsetWidth
  const baseHeight = Number(element.dataset.baseHeight) || element.offsetHeight

  if (baseWidth > 0 && baseHeight > 0) {
    element.dataset.baseWidth = String(baseWidth)
    element.dataset.baseHeight = String(baseHeight)
  }

  const widthLimit = (window.innerWidth - (compact ? 20 : 64)) / Math.max(1, baseWidth)
  const heightLimit = (window.innerHeight * (compact ? 0.62 : 0.68)) / Math.max(1, baseHeight)
  const scale = Math.max(1, Math.min(desiredScale, widthLimit, heightLimit))
  const formattedScale = scale.toFixed(3)

  if (element.dataset.zoomScale !== formattedScale) {
    element.style.setProperty('--map-poem-zoom-scale', formattedScale)
    element.dataset.zoomScale = formattedScale
  }
}

function createVerticalVerseMarker(poem: Poem) {
  const element = document.createElement('article')
  element.className = 'map-poem-sign'
  element.setAttribute('role', 'article')
  element.setAttribute('aria-label', `${poem.author}《${poem.title}》`)
  element.dataset.poemId = poem.id

  const heading = document.createElement('h1')
  heading.textContent = poem.title
  const author = document.createElement('p')
  author.className = 'map-poem-author'
  author.textContent = `${dynastyLabels[poem.dynasty]}·${poem.author}`
  const lines = document.createElement('div')
  lines.className = 'map-poem-lines'
  lines.setAttribute('aria-label', poem.lines.join(''))
  const place = document.createElement('footer')
  place.textContent = `${compactVerticalLabel(poem.placeName)}·${compactVerticalLabel(poem.visualEffectLabel)}`
  element.append(heading, author, lines, place)
  sizeVerticalVerseMarker(element, poem)
  return new Marker({ element, anchor: 'bottom', offset: [0, -28] })
}

function updateVerticalVerseMarker(element: HTMLElement, poem: Poem) {
  element.setAttribute('aria-label', `${poem.author}《${poem.title}》`)
  element.dataset.poemId = poem.id
  const heading = element.querySelector('h1')
  const author = element.querySelector('.map-poem-author')
  const lines = element.querySelector('.map-poem-lines')
  const place = element.querySelector('footer')
  if (heading) heading.textContent = poem.title
  if (author) author.textContent = `${dynastyLabels[poem.dynasty]}·${poem.author}`
  if (lines) lines.setAttribute('aria-label', poem.lines.join(''))
  if (place) {
    place.textContent = `${compactVerticalLabel(poem.placeName)}·${compactVerticalLabel(poem.visualEffectLabel)}`
  }
  sizeVerticalVerseMarker(element, poem)
}

function createPoemEffectMarker(poem: Poem) {
  const element = document.createElement('div')
  element.className = `poem-effect effect-${poem.visualEffect}`
  element.setAttribute('aria-hidden', 'true')
  element.style.setProperty('--effect-accent', poem.accent)

  const core = document.createElement('span')
  core.className = 'effect-core'
  element.append(core)
  for (let index = 0; index < 8; index += 1) {
    const particle = document.createElement('i')
    particle.style.setProperty('--particle-index', String(index))
    element.append(particle)
  }

  return new Marker({ element, anchor: 'center' })
}

function updatePoemEffectMarker(element: HTMLElement, poem: Poem) {
  element.className = `poem-effect effect-${poem.visualEffect}`
  element.style.setProperty('--effect-accent', poem.accent)
}

function createPoemGroupPicker(
  poems: Poem[],
  onSelect: (poem: Poem) => void,
) {
  const element = document.createElement('div')
  // A fan stays legible up to six choices; beyond that the same buttons are
  // set as a short, scrollable register beneath the seal.
  const listed = poems.length > 6
  const places = new Set(poems.map((poem) => poem.placeId))
  const placeLabel = places.size === 1 ? poems[0].placeName : `${poems[0].placeName}一带`
  element.className = listed ? 'poem-group-picker is-list' : 'poem-group-picker'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', `${placeLabel}的${poems.length}首诗`)
  const center = document.createElement('span')
  center.className = 'poem-group-center'
  center.textContent = String(poems.length)
  center.setAttribute('aria-hidden', 'true')
  element.append(center)
  const choices = listed ? document.createElement('div') : element
  if (listed) {
    choices.className = 'poem-group-list'
    const heading = document.createElement('p')
    heading.textContent = `${placeLabel} · ${poems.length}首`
    choices.append(heading)
    choices.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true })
    element.append(choices)
  }

  poems.forEach((poem, index) => {
    // Fan choices into the lower semicircle. The verse slip grows upward from
    // the same geographic anchor, so an upper choice would cover its final
    // columns and make the transient selection state hard to read.
    const angle = poems.length === 1
      ? 90
      : 20 + (140 / (poems.length - 1)) * index
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'poem-group-choice'
    button.style.setProperty('--choice-angle', `${angle}deg`)
    button.style.setProperty('--choice-angle-inverse', `${-angle}deg`)
    button.title = `${poem.author}《${poem.title}》`
    button.setAttribute('aria-label', `选择${poem.author}《${poem.title}》`)
    const title = document.createElement('strong')
    title.textContent = poem.title
    const author = document.createElement('small')
    author.textContent = listed ? `${poem.author} · ${poem.yearLabel}` : poem.author
    button.append(title, author)
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      onSelect(poem)
    })
    choices.append(button)
  })

  return new Marker({ element, anchor: 'center', subpixelPositioning: true })
}

function renderPoetTrail(
  map: MapLibreMap,
  poet: PoetProfile | null,
  poems: Poem[],
  groups: PoemPlaceGroup[],
  selectedPoemId: string,
  previousMarkers: Marker[],
) {
  previousMarkers.forEach((marker) => marker.remove())
  const source = map.getSource('poet-trail') as GeoJSONSource | undefined
  if (!source) return []
  source.setData(poet ? poetTrail(poet, poemsByAuthor(poet.name, poems)).line : emptyTrail)
  applyTrailDimming(map, Boolean(poet))
  refreshPoemSources(map, groups, { selectedPoemId, trailAuthor: poet?.name })
  return poet ? createTrailMarkers(poet).map((marker) => marker.addTo(map)) : []
}

function fitPoetTrail(map: MapLibreMap, poet: PoetProfile, poems: Poem[]) {
  const compact = window.matchMedia('(max-width: 680px)').matches
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const { bounds } = poetTrail(poet, poemsByAuthor(poet.name, poems))
  map.fitBounds(bounds, {
    // Leave the folio (left, or the bottom strip on phones) clear of the path.
    padding: compact
      ? { top: 150, bottom: 300, left: 36, right: 36 }
      : { top: 128, bottom: 96, left: 440, right: 110 },
    maxZoom: 6.4,
    pitch: compact ? 24 : 30,
    bearing: -6,
    duration: reducedMotion ? 0 : 1_300,
    easing: (time) => 1 - Math.pow(1 - time, 3),
  })
}

function focusSelectedPoem(map: MapLibreMap, poem: Poem) {
  const compact = window.matchMedia('(max-width: 680px)').matches
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  map.easeTo({
    center: [poem.longitude, poem.latitude],
    zoom: compact ? 4.55 : 4.7,
    pitch: compact ? 42 : 48,
    // A pitched, rotated camera turns the vertical focus offset into a
    // horizontal drift. Long poem slips then cross the narrow viewport edge.
    bearing: compact ? 0 : -8,
    offset: compact ? [0, 128] : [0, 112],
    duration: reducedMotion ? 0 : 1_450,
    easing: (time) => 1 - Math.pow(1 - time, 3),
  })
}

export function VerseScene({
  poems,
  selectedPoem,
  onSelectPoem,
  onFocusChange,
  trailPoet = null,
  trailFolded = false,
  onUnfold,
}: VerseSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const selectedMarkerRef = useRef<Marker | null>(null)
  const effectMarkerRef = useRef<Marker | null>(null)
  const groupPickerRef = useRef<Marker | null>(null)
  const trailMarkersRef = useRef<Marker[]>([])
  const selectionInitializedRef = useRef(false)
  const introInProgressRef = useRef(false)
  const pendingFocusRef = useRef<Poem | null>(null)
  const selectedPoemRef = useRef(selectedPoem)
  const journeyOriginRef = useRef(selectedPoem)
  const routeAnimationFrameRef = useRef(0)
  const routeSettleTimerRef = useRef(0)
  const onSelectRef = useRef(onSelectPoem)
  const onFocusRef = useRef(onFocusChange)
  const onUnfoldRef = useRef(onUnfold)
  const trailPoetRef = useRef(trailPoet)
  const trailFoldedRef = useRef(trailFolded)
  const placeGroups = useMemo(() => groupPoemsByPlace(poems), [poems])
  // One map lives for the whole visit; a new period only swaps its data.
  const poemsRef = useRef(poems)
  const placeGroupsRef = useRef(placeGroups)

  useEffect(() => {
    onSelectRef.current = onSelectPoem
  }, [onSelectPoem])

  useEffect(() => {
    onFocusRef.current = onFocusChange
  }, [onFocusChange])

  useEffect(() => {
    onUnfoldRef.current = onUnfold
  }, [onUnfold])

  useEffect(() => {
    selectedPoemRef.current = selectedPoem
  }, [selectedPoem])

  useEffect(() => {
    trailPoetRef.current = trailPoet
    trailFoldedRef.current = trailFolded
  }, [trailPoet, trailFolded])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const compact = window.matchMedia('(max-width: 680px)').matches
    const sceneFocus = (): PoemSceneFocus => ({
      selectedPoemId: selectedPoemRef.current.id,
      trailAuthor: trailPoetRef.current?.name,
    })
    // Groups drawn as individual markers right now (unclustered or in focus).
    // Refreshed whenever rendering settles, so hit-testing matches the screen.
    let visibleGroups: PoemPlaceGroup[] = []
    let wheelZoomTimer = 0
    const map = new MapLibreMap({
      container: containerRef.current,
      style: geographicStyle,
      center: compact ? [104, 34] : [101, 34],
      zoom: compact ? 3.55 : 4.2,
      pitch: compact ? 34 : 38,
      bearing: -8,
      maxBounds: classicalChinaBounds,
      maxPitch: 62,
      minZoom: compact ? 3.3 : 4,
      maxZoom: 8,
      renderWorldCopies: false,
      // Retain the previous camera's tiles while the next view resolves.
      // Cancelling requests and using a very small cache produced visible
      // blank-tile flashes during poem journeys and manual panning.
      maxTileCacheSize: compact ? 48 : 96,
      cancelPendingTileRequestsWhileZooming: false,
      refreshExpiredTiles: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      attributionControl: false,
      fadeDuration: 180,
      // MapLibre's native scroll zoom preserves the geographic point under
      // the pointer. Do not override camera updates toward the selected poem.
      scrollZoom: true,
      canvasContextAttributes: {
        antialias: false,
        powerPreference: 'high-performance',
        desynchronized: true,
      },
    })
    mapRef.current = map
    introInProgressRef.current = true

    const compass = document.createElement('button')
    compass.type = 'button'
    compass.className = 'verse-compass'
    compass.setAttribute('aria-label', '归正地图方向')
    compass.innerHTML = '<span>南</span><i></i>'
    compass.addEventListener('click', () => {
      map.easeTo({ bearing: 0, pitch: compact ? 38 : 44, duration: 700 })
    })
    containerRef.current.append(compass)
    let focusFrame = 0
    let lastFocusReport = 0
    const updateMarkerDensity = () => {
      containerRef.current?.classList.toggle('map-near', map.getZoom() >= 4.25)
    }
    const updateVerseSizing = () => {
      const markerElement = selectedMarkerRef.current?.getElement()
      if (markerElement) {
        sizeVerticalVerseMarker(markerElement, selectedPoemRef.current)
        scaleVerticalVerseMarker(markerElement, map)
      }
    }
    const updateVerseScale = () => {
      const markerElement = selectedMarkerRef.current?.getElement()
      if (markerElement) scaleVerticalVerseMarker(markerElement, map)
    }
    const updatePoemScreenPositions = () => {
      const positions = Object.fromEntries(poemsRef.current.map((poem) => {
        const point = map.project([poem.longitude, poem.latitude])
        return [poem.id, { x: Math.round(point.x), y: Math.round(point.y) }]
      }))
      containerRef.current?.setAttribute('data-poem-screen-positions', JSON.stringify(positions))
    }
    const reportFocus = (force = false) => {
      const now = performance.now()
      if (!force && now - lastFocusReport < 120) return
      if (focusFrame) return
      focusFrame = window.requestAnimationFrame(() => {
        const center = map.getCenter()
        onFocusRef.current(projectPoint(center.lng, center.lat))
        lastFocusReport = performance.now()
        focusFrame = 0
      })
    }
    const finishWheelZoom = () => {
      if (wheelZoomTimer) window.clearTimeout(wheelZoomTimer)
      wheelZoomTimer = 0
      containerRef.current?.classList.remove('map-wheel-zooming')
    }
    const handleWheelZoom = () => {
      containerRef.current?.classList.add('map-wheel-zooming')
      if (wheelZoomTimer) window.clearTimeout(wheelZoomTimer)
      // `zoomend` normally closes the session. Keep a generous fallback for
      // slow WebGL frames so the poem slip cannot remain in moving state.
      wheelZoomTimer = window.setTimeout(finishWheelZoom, 1_200)
    }
    const canvas = map.getCanvas()
    canvas.addEventListener('wheel', handleWheelZoom, { passive: true, capture: true })

    map.on('styleimagemissing', (event) => {
      // Count seals are drawn on demand: cluster totals change with the zoom.
      const match = /^(cluster|poem)-count-(\d+)$/u.exec(event.id)
      if (!match || map.hasImage(event.id)) return
      const rendered = createPoemCountImage(Number(match[2]), match[1] === 'cluster' ? 'cluster' : 'badge')
      if (rendered) map.addImage(event.id, rendered.image, { pixelRatio: rendered.pixelRatio })
    })

    map.once('style.load', () => {
      const dynasty = selectedPoemRef.current.dynasty
      const historicalContext = historicalMapContexts[dynasty]
      const groups = placeGroupsRef.current
      addHistoricalLayers(map, groups, sceneFocus(), historicalContext)
      trailMarkersRef.current = renderPoetTrail(
        map,
        trailPoetRef.current,
        poemsRef.current,
        groups,
        selectedPoemRef.current.id,
        trailMarkersRef.current,
      )
      containerRef.current?.setAttribute('data-map-scope', 'classical-china')
      containerRef.current?.setAttribute('data-boundary-rendered', 'false')
      containerRef.current?.setAttribute('data-administrative-division-rendered', 'true')
      containerRef.current?.setAttribute('data-poem-point-style', 'abstract-slip')
      containerRef.current?.setAttribute('data-poem-route-renderer', 'webgl-gradient')
      containerRef.current?.setAttribute('data-poem-route-state', 'idle')
      if (containerRef.current) {
        describePeriod(containerRef.current, dynasty, historicalContext, groups)
      }
      containerRef.current?.setAttribute('data-poem-hit-ready', 'true')
      if (containerRef.current) {
        void addWebglLabelLayers(
          map,
          containerRef.current,
          () => ({
            groups: placeGroupsRef.current,
            context: historicalMapContexts[selectedPoemRef.current.dynasty],
          }),
          () => Boolean(trailPoetRef.current),
        )
      }
      updateMarkerDensity()
      containerRef.current?.setAttribute('data-map-ready', 'true')
      reportFocus()
      window.requestAnimationFrame(() => {
        containerRef.current?.classList.add('map-intro-moving')
        let introFinished = false
        const finishIntro = () => {
          if (introFinished) return
          introFinished = true
          map.off('moveend', finishIntro)
          introInProgressRef.current = false
          containerRef.current?.classList.remove('map-intro-moving')
          containerRef.current?.setAttribute('data-intro-complete', 'true')
          const pendingPoem = pendingFocusRef.current
          pendingFocusRef.current = null
          focusSelectedPoem(map, pendingPoem ?? selectedPoemRef.current)
        }
        // Register before `easeTo`: MapLibre completes motion synchronously
        // when the operating system requests reduced motion.
        map.once('moveend', finishIntro)
        map.easeTo({
          center: compact ? [105.5, 33.2] : [101.5, 34.2],
          zoom: compact ? 3.72 : 4.45,
          pitch: compact ? 42 : 46,
          bearing: -10,
          duration: 2_400,
          easing: (time) => 1 - Math.pow(1 - time, 3),
        })
      })
    })
    const presentLayers = (layers: string[]) => layers.filter((layer) => map.getLayer(layer))
    const refreshVisibleGroups = () => {
      const markerLayers = presentLayers(['poem-location-markers', 'poem-focus-markers'])
      const keys = new Set(markerLayers.length
        ? map.queryRenderedFeatures({ layers: markerLayers })
          .map((feature) => String(feature.properties?.key ?? ''))
        : [])
      visibleGroups = placeGroupsRef.current.filter((group) => keys.has(group.key))
      const clusterLayers = presentLayers(['poem-clusters'])
      const clusters = clusterLayers.length
        ? map.queryRenderedFeatures({ layers: clusterLayers }).map((feature) => {
          const [longitude, latitude] = (feature.geometry as GeoJSON.Point).coordinates
          const point = map.project([longitude, latitude])
          return {
            x: Math.round(point.x),
            y: Math.round(point.y),
            count: Number(feature.properties?.poemCount ?? 0),
          }
        })
        : []
      containerRef.current?.setAttribute(
        'data-poem-visible-places',
        JSON.stringify([...keys].sort()),
      )
      containerRef.current?.setAttribute('data-poem-clusters', JSON.stringify(clusters))
    }
    const findMarkerGroup = (point: { x: number; y: number }) => {
      let closestGroup: PoemPlaceGroup | undefined
      let closestScore = Number.POSITIVE_INFINITY
      visibleGroups.forEach((group) => {
        const ground = map.project([group.longitude, group.latitude])
        const head = {
          x: ground.x,
          y: ground.y - poemMarkerHeight + poemMarkerHeadCenterY,
        }
        const headDistance = Math.hypot(point.x - head.x, point.y - head.y)
        const baseDistance = Math.hypot(point.x - ground.x, point.y - ground.y)
        const score = Math.min(headDistance / 21, baseDistance / 24)
        if (score <= 1 && score < closestScore) {
          closestGroup = group
          closestScore = score
        }
      })
      return closestGroup
    }
    const findCluster = (point: { x: number; y: number }) => {
      const layers = presentLayers(['poem-clusters'])
      if (!layers.length) return undefined
      return map.queryRenderedFeatures(
        [[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]],
        { layers },
      )[0]
    }
    const closePicker = () => {
      groupPickerRef.current?.remove()
      groupPickerRef.current = null
    }
    const openPicker = (groupPoems: Poem[], at: [number, number]) => {
      closePicker()
      const ordered = [...groupPoems]
        .sort((first, second) => first.year - second.year)
      groupPickerRef.current = createPoemGroupPicker(ordered, (poem) => {
        closePicker()
        onSelectRef.current(poem)
      })
        .setLngLat(at)
        .addTo(map)
    }
    const openCluster = async (feature: GeoJSON.Feature) => {
      const source = map.getSource('poems') as GeoJSONSource | undefined
      const clusterId = Number(feature.properties?.cluster_id)
      if (!source || !Number.isFinite(clusterId)) return
      const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number]
      const expansionZoom = await source.getClusterExpansionZoom(clusterId)
      if (expansionZoom <= map.getMaxZoom()) {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        map.easeTo({
          center: coordinates,
          zoom: Math.max(expansionZoom, map.getZoom() + 0.8),
          duration: reducedMotion ? 0 : 900,
          easing: (time) => 1 - Math.pow(1 - time, 3),
        })
        return
      }
      // Sites too close to separate even at full zoom: list them instead.
      const leaves = await source.getClusterLeaves(clusterId, Number.POSITIVE_INFINITY, 0)
      const memberIds = new Set(leaves.flatMap((leaf) => {
        try {
          return JSON.parse(String(leaf.properties?.memberIds ?? '[]')) as string[]
        } catch {
          return []
        }
      }))
      openPicker(poemsRef.current.filter((poem) => memberIds.has(poem.id)), coordinates)
    }

    map.on('click', (event) => {
      const directGroup = findMarkerGroup(event.point)
      if (directGroup) {
        if (directGroup.poems.length === 1) {
          closePicker()
          onSelectRef.current(directGroup.poems[0])
          return
        }
        openPicker(directGroup.poems, [directGroup.longitude, directGroup.latitude])
        return
      }
      const cluster = findCluster(event.point)
      if (cluster) {
        closePicker()
        void openCluster(cluster)
        return
      }
      const labelLayers = presentLayers([
        'poem-place-labels',
        'poem-focus-labels',
        'poem-selected-place-label',
      ])
      const label = labelLayers.length
        ? map.queryRenderedFeatures(event.point, { layers: labelLayers })[0]
        : undefined
      const labelGroup = placeGroupsRef.current.find((group) => group.key === label?.properties?.key)
      if (!labelGroup) {
        closePicker()
        return
      }
      if (labelGroup.poems.length === 1) {
        closePicker()
        onSelectRef.current(labelGroup.poems[0])
        return
      }
      openPicker(labelGroup.poems, [labelGroup.longitude, labelGroup.latitude])
    })
    map.on('mousemove', (event) => {
      if (findMarkerGroup(event.point) || findCluster(event.point)) {
        map.getCanvas().style.cursor = 'pointer'
        return
      }
      const labelLayers = presentLayers([
        'poem-place-labels',
        'poem-focus-labels',
        'poem-selected-place-label',
      ])
      const overLabel = labelLayers.length > 0
        && map.queryRenderedFeatures(event.point, { layers: labelLayers }).length > 0
      map.getCanvas().style.cursor = overLabel ? 'pointer' : ''
    })
    map.on('movestart', () => {
      containerRef.current?.classList.add('map-moving')
      closePicker()
    })
    map.on('move', () => reportFocus())
    map.on('moveend', () => {
      containerRef.current?.classList.remove('map-moving')
      updatePoemScreenPositions()
      reportFocus(true)
    })
    map.on('idle', refreshVisibleGroups)
    map.on('zoom', () => {
      updateMarkerDensity()
      updateVerseScale()
    })
    map.on('zoomend', finishWheelZoom)
    map.on('resize', () => {
      updateVerseSizing()
      updatePoemScreenPositions()
    })

    return () => {
      if (focusFrame) window.cancelAnimationFrame(focusFrame)
      if (routeAnimationFrameRef.current) {
        window.cancelAnimationFrame(routeAnimationFrameRef.current)
        routeAnimationFrameRef.current = 0
      }
      if (routeSettleTimerRef.current) {
        window.clearTimeout(routeSettleTimerRef.current)
        routeSettleTimerRef.current = 0
      }
      finishWheelZoom()
      canvas.removeEventListener('wheel', handleWheelZoom, true)
      compass.remove()
      selectedMarkerRef.current?.remove()
      effectMarkerRef.current?.remove()
      groupPickerRef.current?.remove()
      trailMarkersRef.current.forEach((marker) => marker.remove())
      selectedMarkerRef.current = null
      effectMarkerRef.current = null
      groupPickerRef.current = null
      trailMarkersRef.current = []
      selectionInitializedRef.current = false
      introInProgressRef.current = false
      pendingFocusRef.current = null
      journeyOriginRef.current = selectedPoemRef.current
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (poemsRef.current === poems) return
    poemsRef.current = poems
    placeGroupsRef.current = placeGroups
    const map = mapRef.current
    const container = containerRef.current
    // Before the style loads, `style.load` reads the refs above instead.
    if (!map || !container || !map.getSource('poems')) return
    const dynasty = poems[0]?.dynasty ?? selectedPoemRef.current.dynasty
    const context = historicalMapContexts[dynasty]
    // Label layers exist only once fonts are ready; until then they will draw
    // the current period's names themselves.
    const labelsReady = Boolean(map.getSource('historical-labels'))
    if (labelsReady) addPeriodLabelImages(map, placeGroups, context)
    ;(map.getSource('historical-regions') as GeoJSONSource | undefined)
      ?.setData(historicalDivisionCollection(context))
    if (labelsReady) {
      ;(map.getSource('historical-labels') as GeoJSONSource).setData(historicalLabelCollection(context))
    }
    refreshPoemSources(map, placeGroups, {
      selectedPoemId: selectedPoemRef.current.id,
      trailAuthor: trailPoetRef.current?.name,
    })
    describePeriod(container, dynasty, context, placeGroups)
  }, [placeGroups, poems])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const previousPoem = journeyOriginRef.current
    journeyOriginRef.current = selectedPoem
    groupPickerRef.current?.remove()
    groupPickerRef.current = null
    if (effectMarkerRef.current) {
      updatePoemEffectMarker(effectMarkerRef.current.getElement(), selectedPoem)
      effectMarkerRef.current.setLngLat([selectedPoem.longitude, selectedPoem.latitude])
    } else {
      effectMarkerRef.current = createPoemEffectMarker(selectedPoem)
        .setLngLat([selectedPoem.longitude, selectedPoem.latitude])
        .addTo(map)
    }
    if (selectedMarkerRef.current) {
      updateVerticalVerseMarker(selectedMarkerRef.current.getElement(), selectedPoem)
      selectedMarkerRef.current.setLngLat([selectedPoem.longitude, selectedPoem.latitude])
    } else {
      selectedMarkerRef.current = createVerticalVerseMarker(selectedPoem)
        .setLngLat([selectedPoem.longitude, selectedPoem.latitude])
        .addTo(map)
      const signElement = selectedMarkerRef.current.getElement()
      signElement.addEventListener('click', (event) => {
        // A folded slip is a tab: opening it returns the camera to the poem.
        if (!signElement.classList.contains('is-folded')) return
        event.stopPropagation()
        onUnfoldRef.current?.()
      })
      signElement.addEventListener('keydown', (event) => {
        if (!signElement.classList.contains('is-folded')) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onUnfoldRef.current?.()
      })
    }
    scaleVerticalVerseMarker(selectedMarkerRef.current.getElement(), map)

    refreshPoemSources(map, placeGroupsRef.current, {
      selectedPoemId: selectedPoem.id,
      trailAuthor: trailPoetRef.current?.name,
    })

    if (!selectionInitializedRef.current) {
      selectionInitializedRef.current = true
      return
    }

    const routeSource = map.getSource('poem-route') as GeoJSONSource | undefined
    if (routeSource && previousPoem.id !== selectedPoem.id) {
      if (routeAnimationFrameRef.current) {
        window.cancelAnimationFrame(routeAnimationFrameRef.current)
        routeAnimationFrameRef.current = 0
      }
      if (routeSettleTimerRef.current) {
        window.clearTimeout(routeSettleTimerRef.current)
        routeSettleTimerRef.current = 0
      }
    }
    if (routeSource && previousPoem.dynasty !== selectedPoem.dynasty) {
      // The ink line reads as a journey; works centuries apart share no road.
      routeSource.setData(emptyPoemRoute())
      containerRef.current?.removeAttribute('data-poem-route-from')
      containerRef.current?.removeAttribute('data-poem-route-to')
      containerRef.current?.setAttribute('data-poem-route-state', 'idle')
    } else if (routeSource && previousPoem.id !== selectedPoem.id) {
      const route = poemRoute(previousPoem, selectedPoem)
      routeSource.setData(route)
      containerRef.current?.setAttribute('data-poem-route-from', previousPoem.id)
      containerRef.current?.setAttribute('data-poem-route-to', selectedPoem.id)

      if (route.features.length === 0) {
        containerRef.current?.setAttribute('data-poem-route-state', 'same-place')
      } else {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        map.setPaintProperty('poem-route-ink', 'line-gradient', routeInkGradient(0))
        map.setPaintProperty('poem-route-flow', 'line-gradient', transparentRouteGradient)

        if (reducedMotion) {
          map.setPaintProperty('poem-route-ink', 'line-gradient', routeInkGradient(1))
          containerRef.current?.setAttribute('data-poem-route-state', 'settled')
        } else {
          const startedAt = performance.now()
          let lastPaintAt = 0
          containerRef.current?.setAttribute('data-poem-route-state', 'animating')
          const drawRoute = (now: number) => {
            const linearProgress = Math.min(1, (now - startedAt) / 1_600)
            if (linearProgress < 1 && now - lastPaintAt < 32) {
              routeAnimationFrameRef.current = window.requestAnimationFrame(drawRoute)
              return
            }
            const progress = linearProgress * linearProgress * (3 - 2 * linearProgress)
            lastPaintAt = now
            map.setPaintProperty('poem-route-ink', 'line-gradient', routeInkGradient(progress))
            map.setPaintProperty('poem-route-flow', 'line-gradient', routeFlowGradient(progress))

            if (linearProgress < 1) {
              routeAnimationFrameRef.current = window.requestAnimationFrame(drawRoute)
              return
            }

            routeAnimationFrameRef.current = 0
            containerRef.current?.setAttribute('data-poem-route-state', 'settled')
            routeSettleTimerRef.current = window.setTimeout(() => {
              if (map.getLayer('poem-route-flow')) {
                map.setPaintProperty(
                  'poem-route-flow',
                  'line-gradient',
                  transparentRouteGradient,
                )
              }
              routeSettleTimerRef.current = 0
            }, 280)
          }
          routeAnimationFrameRef.current = window.requestAnimationFrame(drawRoute)
        }
      }
    }

    if (introInProgressRef.current) {
      pendingFocusRef.current = selectedPoem
      return
    }
    // While a folded trail is on screen the whole life stays framed.
    if (trailPoetRef.current && trailFoldedRef.current) return
    focusSelectedPoem(map, selectedPoem)
  }, [selectedPoem])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getSource('poet-trail')) return
    trailMarkersRef.current = renderPoetTrail(
      map,
      trailPoet,
      poems,
      placeGroups,
      selectedPoemRef.current.id,
      trailMarkersRef.current,
    )
  }, [placeGroups, poems, trailPoet])

  const trailFramedRef = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    const folded = Boolean(trailPoet) && trailFolded
    const signElement = selectedMarkerRef.current?.getElement()
    if (signElement) {
      signElement.classList.toggle('is-folded', folded)
      if (folded) {
        signElement.setAttribute('role', 'button')
        signElement.setAttribute('tabindex', '0')
        signElement.setAttribute('aria-label', `展开《${selectedPoemRef.current.title}》诗签`)
      } else {
        const poem = selectedPoemRef.current
        signElement.setAttribute('role', 'article')
        signElement.removeAttribute('tabindex')
        signElement.setAttribute('aria-label', `${poem.author}《${poem.title}》`)
      }
    }
    containerRef.current?.setAttribute('data-poet-trail', trailPoet?.name ?? '')
    containerRef.current?.setAttribute('data-trail-folded', String(folded))
    if (map?.getLayer('poem-selected-place-label')) {
      // The folded slip already names the poem; its place label would only
      // sit beneath the tab and collide with the station names.
      map.setLayoutProperty('poem-selected-place-label', 'visibility', folded ? 'none' : 'visible')
    }
    if (!map || introInProgressRef.current) return
    if (trailPoet && trailFolded) {
      trailFramedRef.current = true
      fitPoetTrail(map, trailPoet, poems)
      return
    }
    if (trailFramedRef.current) {
      trailFramedRef.current = false
      focusSelectedPoem(map, selectedPoemRef.current)
    }
  }, [poems, trailFolded, trailPoet])

  return (
    <div
      ref={containerRef}
      className="geographic-map"
      aria-label={`${dynastyLabels[selectedPoem.dynasty]}诗词与${historicalMapContexts[selectedPoem.dynasty].systemLabel}概念行政区划 WebGL 地形地图`}
    />
  )
}
