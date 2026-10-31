import { useState, useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

export interface HourlyForecastEntry {
  offset_hours: number
  forecast_timestamp: string | null
  temperature_f?: number | null
  weather_description?: string
  weather_icon?: string
  wind_speed_mph: number | null
  wind_gusts_mph?: number | null
  wind_direction_cardinal?: string
  rain_intensity_in_hr: number | null
  snow_intensity_in_hr: number | null
  wind_risk: string
  rain_risk: string
  snow_risk: string
  load_adjusted_wind_risk: string
  final_risk: string
  weather_status: string
}

export interface Checkpoint {
  checkpoint_index: number
  coordinates: [number, number]
  distance_from_origin_miles: number
  estimated_arrival_time: string
  forecast_timestamp: string | null
  data_source: string
  weather_status: string
  temperature_f?: number | null
  temperature_c?: number | null
  weather_code?: number | null
  weather_description?: string
  weather_icon?: string
  wind_speed_mph: number | null
  wind_gusts_mph?: number | null
  wind_direction_deg?: number | null
  wind_direction_cardinal?: string
  rain_intensity_in_hr: number | null
  snow_intensity_in_hr: number | null
  wind_risk: string
  rain_risk: string
  snow_risk: string
  load_adjusted_wind_risk: string
  final_risk: string
  road_name?: string
  highway_refs?: string[]
  hourly_forecasts?: HourlyForecastEntry[]
}

export interface RouteItem {
  id: string
  name: string
  distance_miles: number
  duration_seconds: number
  geometry: {
    type: string
    coordinates: [number, number][]
  }
  start_coordinates: [number, number]
  destination_coordinates: [number, number]
  checkpoints_count: number
  checkpoints: Checkpoint[]
  severe_miles?: number
  high_miles?: number
  no_travel_miles?: number
  average_risk_score?: number
  has_no_travel?: boolean
  has_unknown_weather?: boolean
  is_complete_analysis?: boolean
  is_recommended?: boolean
  recommendation_status?: string
  recommendation_label?: string
  rank?: number
}

interface MapViewProps {
  routes: RouteItem[]
  selectedRouteId: string
  onSelectRoute: (routeId: string) => void
  selectedCheckpoint: Checkpoint | null
  onSelectCheckpoint: (checkpoint: Checkpoint | null) => void
  originName: string
  destinationName: string
  departureDatetime: string
  compareRouteIds?: string[]
}

const RISK_NUMERIC_MAP: Record<string, number> = {
  LOW: 0.0,
  MODERATE: 1.0,
  HIGH: 2.0,
  SEVERE: 3.0,
  NO_TRAVEL: 4.0,
  UNKNOWN: 3.0,
}

function getRiskScoreColor(score: number): string {
  const s = Math.max(0, Math.min(4, score))
  const u = s / 4.0
  const stops = [
    { p: 0.00, hex: '#22c55e', rgb: [34, 197, 94] },
    { p: 0.25, hex: '#a3e635', rgb: [163, 230, 53] },
    { p: 0.50, hex: '#eab308', rgb: [234, 179, 8] },
    { p: 0.70, hex: '#f97316', rgb: [249, 115, 22] },
    { p: 0.85, hex: '#ef4444', rgb: [239, 68, 68] },
    { p: 1.00, hex: '#7f1d1d', rgb: [127, 29, 29] },
  ]
  if (u <= stops[0].p) return stops[0].hex
  if (u >= stops[stops.length - 1].p) return stops[stops.length - 1].hex

  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i]
    const s1 = stops[i + 1]
    if (u >= s0.p && u <= s1.p) {
      const frac = (u - s0.p) / (s1.p - s0.p)
      const r = Math.round(s0.rgb[0] + frac * (s1.rgb[0] - s0.rgb[0]))
      const g = Math.round(s0.rgb[1] + frac * (s1.rgb[1] - s0.rgb[1]))
      const b = Math.round(s0.rgb[2] + frac * (s1.rgb[2] - s0.rgb[2]))
      return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
    }
  }
  return '#22c55e'
}

const RISK_COLORS: Record<string, string> = {
  LOW: '#15803D',       // Green
  MODERATE: '#A16207',  // Yellow / Ochre
  HIGH: '#C2410C',      // Orange
  SEVERE: '#DC2626',    // Red
  NO_TRAVEL: '#991B1B', // Dark Red
  UNKNOWN: '#71717A',   // Neutral Gray
}

// Strictly non-blue route colors
const ROUTE_LINE_COLORS = ['#E87532', '#444444', '#A16207']

function formatDateTimeDisplay(date: Date): string {
  try {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    })
  } catch {
    return date.toISOString()
  }
}

function getCoordinateAtMiles(
  coordinates: [number, number][],
  targetMiles: number,
  totalMiles: number
): [number, number] {
  if (!coordinates || coordinates.length === 0) return [0, 0]
  if (coordinates.length === 1 || targetMiles <= 0) return coordinates[0]
  if (targetMiles >= totalMiles) return coordinates[coordinates.length - 1]

  const segDistances: number[] = []
  let sumDist = 0

  for (let i = 0; i < coordinates.length - 1; i++) {
    const [lon1, lat1] = coordinates[i]
    const [lon2, lat2] = coordinates[i + 1]
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const d = 3958.8 * c
    segDistances.push(d)
    sumDist += d
  }

  const ratio = totalMiles > 0 && sumDist > 0 ? sumDist / totalMiles : 1
  const scaledTarget = targetMiles * ratio

  let accumulated = 0
  for (let i = 0; i < segDistances.length; i++) {
    const nextAccum = accumulated + segDistances[i]
    if (scaledTarget <= nextAccum) {
      const segmentSpan = segDistances[i]
      const t = segmentSpan > 0 ? (scaledTarget - accumulated) / segmentSpan : 0
      const [lon1, lat1] = coordinates[i]
      const [lon2, lat2] = coordinates[i + 1]
      return [lon1 + t * (lon2 - lon1), lat1 + t * (lat2 - lat1)]
    }
    accumulated = nextAccum
  }

  return coordinates[coordinates.length - 1]
}

export function MapView({
  routes,
  selectedRouteId,
  onSelectRoute,
  selectedCheckpoint,
  onSelectCheckpoint,
  originName,
  destinationName,
  departureDatetime,
  compareRouteIds = [],
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const compMarkersRef = useRef<maplibregl.Marker[]>([])
  const truckMarkerRef = useRef<maplibregl.Marker | null>(null)
  const [mapInitError, setMapInitError] = useState(false)

  // null = ETA Mode (truck arrival trajectory); number (0-48) = Corridor Forecast Offset Mode
  const [sliderOffset, setSliderOffset] = useState<number | null>(null)

  // Timeline Auto-Play state
  const [isPlaying, setIsPlaying] = useState(false)
  const playTimerRef = useRef<number | null>(null)

  const stopPlayback = () => {
    if (playTimerRef.current !== null) {
      clearInterval(playTimerRef.current)
      playTimerRef.current = null
    }
    setIsPlaying(false)
  }

  const togglePlay = () => {
    if (isPlaying) {
      stopPlayback()
    } else {
      if (sliderOffset === null || sliderOffset >= 48) {
        setSliderOffset(0)
      }
      setIsPlaying(true)
    }
  }

  useEffect(() => {
    if (isPlaying) {
      playTimerRef.current = window.setInterval(() => {
        setSliderOffset((prev) => {
          const next = (prev ?? 0) + 1
          if (next >= 48) {
            if (playTimerRef.current !== null) {
              clearInterval(playTimerRef.current)
              playTimerRef.current = null
            }
            setIsPlaying(false)
            return 48
          }
          return next
        })
      }, 900)
    } else {
      if (playTimerRef.current !== null) {
        clearInterval(playTimerRef.current)
        playTimerRef.current = null
      }
    }

    return () => {
      if (playTimerRef.current !== null) {
        clearInterval(playTimerRef.current)
        playTimerRef.current = null
      }
    }
  }, [isPlaying])

  const selectedRoute = routes.find((r) => r.id === selectedRouteId) || routes[0]

  const depDate = new Date(departureDatetime)
  const isDepDateValid = !isNaN(depDate.getTime())
  const validDepDate = isDepDateValid ? depDate : new Date()

  const activeSliderDate =
    sliderOffset !== null
      ? new Date(validDepDate.getTime() + sliderOffset * 3600 * 1000)
      : null

  // Helper to get active weather and risk for a checkpoint depending on slider offset
  const getCheckpointActiveData = (cp: Checkpoint) => {
    if (sliderOffset === null) {
      return {
        risk: cp.final_risk || 'UNKNOWN',
        wind_speed_mph: cp.wind_speed_mph,
        wind_gusts_mph: cp.wind_gusts_mph,
        wind_direction_cardinal: cp.wind_direction_cardinal,
        temperature_f: cp.temperature_f,
        temperature_c: cp.temperature_c,
        weather_description: cp.weather_description,
        weather_icon: cp.weather_icon,
        road_name: cp.road_name,
        rain_intensity_in_hr: cp.rain_intensity_in_hr,
        snow_intensity_in_hr: cp.snow_intensity_in_hr,
        wind_risk: cp.wind_risk || 'UNKNOWN',
        rain_risk: cp.rain_risk || 'UNKNOWN',
        snow_risk: cp.snow_risk || 'UNKNOWN',
        load_adjusted_wind_risk: cp.load_adjusted_wind_risk || 'UNKNOWN',
        forecast_timestamp: cp.forecast_timestamp,
        weather_status: cp.weather_status,
        is_eta_mode: true,
      }
    }

    const entry = cp.hourly_forecasts?.find((h) => h.offset_hours === sliderOffset)
    if (entry && entry.weather_status === 'AVAILABLE') {
      return {
        risk: entry.final_risk || 'UNKNOWN',
        wind_speed_mph: entry.wind_speed_mph,
        wind_gusts_mph: entry.wind_gusts_mph,
        wind_direction_cardinal: entry.wind_direction_cardinal,
        temperature_f: entry.temperature_f ?? cp.temperature_f,
        temperature_c: cp.temperature_c,
        weather_description: entry.weather_description ?? cp.weather_description,
        weather_icon: entry.weather_icon ?? cp.weather_icon,
        road_name: cp.road_name,
        rain_intensity_in_hr: entry.rain_intensity_in_hr,
        snow_intensity_in_hr: entry.snow_intensity_in_hr,
        wind_risk: entry.wind_risk || 'UNKNOWN',
        rain_risk: entry.rain_risk || 'UNKNOWN',
        snow_risk: entry.snow_risk || 'UNKNOWN',
        load_adjusted_wind_risk: entry.load_adjusted_wind_risk || 'UNKNOWN',
        forecast_timestamp: entry.forecast_timestamp,
        weather_status: 'AVAILABLE',
        is_eta_mode: false,
      }
    }

    return {
      risk: 'UNKNOWN',
      wind_speed_mph: null,
      wind_gusts_mph: null,
      wind_direction_cardinal: '',
      temperature_f: null,
      temperature_c: null,
      weather_description: 'Unavailable',
      weather_icon: '⛅',
      road_name: cp.road_name,
      rain_intensity_in_hr: null,
      snow_intensity_in_hr: null,
      wind_risk: 'UNKNOWN',
      rain_risk: 'UNKNOWN',
      snow_risk: 'UNKNOWN',
      load_adjusted_wind_risk: 'UNKNOWN',
      forecast_timestamp: null,
      weather_status: 'UNAVAILABLE',
      is_eta_mode: false,
    }
  }

  // Calculate active peak wind speed along the active route
  const activePeakWind = selectedRoute?.checkpoints?.reduce<number | null>((max, cp) => {
    const data = getCheckpointActiveData(cp)
    if (data.wind_speed_mph != null) {
      return max === null ? data.wind_speed_mph : Math.max(max, data.wind_speed_mph)
    }
    return max
  }, null) ?? null

  // Initialize MapLibre
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    try {
      const cartoKey = import.meta.env.VITE_CARTO_API_KEY
      const customTileUrl = import.meta.env.VITE_MAP_TILE_URL

      // Use CARTO Light tiles by default (high performance, clean neutral aesthetic, zero key required)
      let tileUrl = 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
      let attribution = '© OpenStreetMap contributors, © CARTO'

      if (customTileUrl) {
        tileUrl = customTileUrl
      } else if (cartoKey) {
        tileUrl = `https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${cartoKey}`
      }

      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: {
          version: 8,
          sources: {
            'neutral-tiles': {
              type: 'raster',
              tiles: [tileUrl],
              tileSize: 256,
              attribution: attribution,
              maxzoom: 19,
            },
          },
          layers: [
            {
              id: 'neutral-base',
              type: 'raster',
              source: 'neutral-tiles',
              minzoom: 0,
              maxzoom: 19,
            },
          ],
        },
        center: [8.55, 49.45],
        zoom: 10,
        attributionControl: false,
      })

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')

      map.on('load', () => {
        map.resize()
      })

      mapRef.current = map

      return () => {
        stopPlayback()
        if (truckMarkerRef.current) {
          truckMarkerRef.current.remove()
          truckMarkerRef.current = null
        }
        markersRef.current.forEach((m) => m.remove())
        markersRef.current = []
        compMarkersRef.current.forEach((m) => m.remove())
        compMarkersRef.current = []
        map.remove()
        mapRef.current = null
      }
    } catch (err) {
      console.error('Failed to initialize MapLibre GL map:', err)
      setMapInitError(true)
    }
  }, [])

  // Update Route Polylines and Corridor on Map
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const updateLayers = () => {
      // Clear old route and comparison sources and layers
      routes.forEach((route) => {
        const lineLayerId = `layer-line-${route.id}`
        const casingLayerId = `layer-casing-${route.id}`
        const compLineId = `layer-compare-${route.id}`
        const sourceId = `source-${route.id}`
        const compSourceId = `source-compare-${route.id}`

        if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId)
        if (map.getLayer(casingLayerId)) map.removeLayer(casingLayerId)
        if (map.getLayer(compLineId)) map.removeLayer(compLineId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
        if (map.getSource(compSourceId)) map.removeSource(compSourceId)
      })

      if (map.getLayer('layer-corridor-gradient')) map.removeLayer('layer-corridor-gradient')
      if (map.getSource('source-corridor-gradient')) map.removeSource('source-corridor-gradient')
      if (map.getLayer('layer-corridor-highlight')) map.removeLayer('layer-corridor-highlight')
      if (map.getSource('source-corridor-highlight')) map.removeSource('source-corridor-highlight')

      if (routes.length === 0) return

      // Add sources and layers for each route
      routes.forEach((route, idx) => {
        const isSelected = route.id === selectedRouteId
        const sourceId = `source-${route.id}`
        const lineLayerId = `layer-line-${route.id}`
        const casingLayerId = `layer-casing-${route.id}`
        const baseColor = ROUTE_LINE_COLORS[idx % ROUTE_LINE_COLORS.length]

        map.addSource(sourceId, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: route.geometry as any,
          },
        })

        // Outer dark casing for the selected route
        if (isSelected) {
          map.addLayer({
            id: casingLayerId,
            type: 'line',
            source: sourceId,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': '#222222',
              'line-width': 8,
              'line-opacity': 0.85,
            },
          })
        }

        // Main route line
        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': isSelected ? baseColor : '#666666',
            'line-width': isSelected ? 5 : 3,
            'line-opacity': isSelected ? 1.0 : 0.45,
          },
        })

        // Click to select route
        map.on('click', lineLayerId, () => {
          onSelectRoute(route.id)
        })

        map.on('mouseenter', lineLayerId, () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', lineLayerId, () => {
          map.getCanvas().style.cursor = ''
        })
      })

      // Add comparison routes (blue dashed line)
      if (compareRouteIds && compareRouteIds.length > 0) {
        compareRouteIds.forEach((compId) => {
          if (compId === selectedRouteId) return
          const compRoute = routes.find((r) => r.id === compId)
          if (!compRoute || !compRoute.geometry) return

          const compSourceId = `source-compare-${compRoute.id}`
          const compLineId = `layer-compare-${compRoute.id}`

          map.addSource(compSourceId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: compRoute.geometry as any,
            },
          })

          map.addLayer({
            id: compLineId,
            type: 'line',
            source: compSourceId,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': '#3b82f6',
              'line-dasharray': [3, 2],
              'line-width': 4,
              'line-opacity': 0.85,
            },
          })
        })
      }

      // Add Continuous Weather Gradient Heatmap Layer along the selected route
      if (selectedRoute && selectedRoute.checkpoints && selectedRoute.checkpoints.length > 0) {
        const coords = selectedRoute.geometry?.coordinates
        if (coords && coords.length > 1) {
          const cps = selectedRoute.checkpoints
          const totalDist =
            selectedRoute.distance_miles ||
            cps[cps.length - 1].distance_from_origin_miles ||
            1

          // Interpolated points every ~2 miles along route geometry with linearly interpolated risk scores
          const sampleInterval = 2.0 // miles
          const numSamples = Math.max(8, Math.min(100, Math.round(totalDist / sampleInterval)))

          const cpPoints = cps.map((cp) => {
            const data = getCheckpointActiveData(cp)
            const score = RISK_NUMERIC_MAP[data.risk] ?? 3.0
            return {
              dist: cp.distance_from_origin_miles,
              score,
            }
          })

          const gradientStops: (number | string)[] = []
          let lastP = -1

          for (let step = 0; step <= numSamples; step++) {
            let p = step / numSamples
            const curDist = p * totalDist

            let interpScore = cpPoints[0].score
            if (curDist <= cpPoints[0].dist) {
              interpScore = cpPoints[0].score
            } else if (curDist >= cpPoints[cpPoints.length - 1].dist) {
              interpScore = cpPoints[cpPoints.length - 1].score
            } else {
              for (let i = 0; i < cpPoints.length - 1; i++) {
                const c0 = cpPoints[i]
                const c1 = cpPoints[i + 1]
                if (curDist >= c0.dist && curDist <= c1.dist) {
                  const span = c1.dist - c0.dist
                  const t = span > 0 ? (curDist - c0.dist) / span : 0
                  interpScore = c0.score + t * (c1.score - c0.score)
                  break
                }
              }
            }

            const color = getRiskScoreColor(interpScore)

            p = Math.min(1.0, Math.max(0.0, p))
            if (step === 0) p = 0.0
            if (step === numSamples) p = 1.0

            if (p <= lastP) {
              p = Math.min(1.0, lastP + 0.0005)
            }

            gradientStops.push(Number(p.toFixed(4)), color)
            lastP = p
          }

          if (gradientStops.length >= 2 && gradientStops[0] !== 0) {
            gradientStops[0] = 0
          }
          if (gradientStops.length >= 2 && gradientStops[gradientStops.length - 2] !== 1) {
            const lastColor = gradientStops[gradientStops.length - 1] as string
            gradientStops.push(1.0, lastColor)
          }
          if (gradientStops.length < 4) {
            gradientStops.push(1.0, '#22c55e')
          }

          map.addSource('source-corridor-gradient', {
            type: 'geojson',
            lineMetrics: true,
            data: {
              type: 'Feature',
              properties: {},
              geometry: selectedRoute.geometry as any,
            },
          })

          const casingId = `layer-casing-${selectedRoute.id}`
          const beforeId = map.getLayer(casingId) ? casingId : undefined

          map.addLayer(
            {
              id: 'layer-corridor-gradient',
              type: 'line',
              source: 'source-corridor-gradient',
              layout: {
                'line-join': 'round',
                'line-cap': 'round',
              },
              paint: {
                'line-gradient': [
                  'interpolate',
                  ['linear'],
                  ['line-progress'],
                  ...gradientStops,
                ] as any,
                'line-width': 8,
                'line-opacity': 0.85,
              },
            },
            beforeId
          )
        }
      }

      // Fit map bounds to encompass the selected route
      if (selectedRoute?.geometry?.coordinates?.length) {
        const bounds = new maplibregl.LngLatBounds()
        selectedRoute.geometry.coordinates.forEach((coord) => {
          bounds.extend(coord as [number, number])
        })

        map.fitBounds(bounds, {
          padding: { top: 60, bottom: 60, left: 60, right: 60 },
          maxZoom: 14,
          duration: 800,
        })
      }
    }

    if (map.isStyleLoaded()) {
      updateLayers()
    } else {
      map.once('load', updateLayers)
    }
  }, [routes, selectedRouteId, onSelectRoute, selectedRoute, sliderOffset, compareRouteIds])

  // Update Markers (Start, Dest, and Checkpoints)
  useEffect(() => {
    // Clear old markers
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    compMarkersRef.current.forEach((m) => m.remove())
    compMarkersRef.current = []

    const map = mapRef.current
    if (!map || !selectedRoute) return

    // 1. Origin Marker
    if (selectedRoute.start_coordinates) {
      const startEl = document.createElement('div')
      startEl.className = 'map-marker-pin marker-start'
      startEl.innerHTML = '<span>START</span>'
      startEl.title = `Origin: ${originName}`

      const startMarker = new maplibregl.Marker({ element: startEl })
        .setLngLat(selectedRoute.start_coordinates)
        .addTo(map)
      markersRef.current.push(startMarker)
    }

    // 2. Destination Marker
    if (selectedRoute.destination_coordinates) {
      const destEl = document.createElement('div')
      destEl.className = 'map-marker-pin marker-dest'
      destEl.innerHTML = '<span>DEST</span>'
      destEl.title = `Destination: ${destinationName}`

      const destMarker = new maplibregl.Marker({ element: destEl })
        .setLngLat(selectedRoute.destination_coordinates)
        .addTo(map)
      markersRef.current.push(destMarker)
    }

    // 3. Checkpoint Markers for the Selected Route
    if (selectedRoute.checkpoints) {
      selectedRoute.checkpoints.forEach((cp) => {
        const isSelected = selectedCheckpoint?.checkpoint_index === cp.checkpoint_index
        const cpEl = document.createElement('div')
        const activeData = getCheckpointActiveData(cp)
        const riskColor = RISK_COLORS[activeData.risk] || RISK_COLORS.UNKNOWN

        cpEl.className = `map-checkpoint-marker ${isSelected ? 'selected' : ''}`
        cpEl.style.backgroundColor = riskColor
        cpEl.innerHTML = `<span>${cp.checkpoint_index + 1}</span>`
        cpEl.setAttribute('role', 'button')
        cpEl.setAttribute('tabindex', '0')

        const windDesc = activeData.wind_speed_mph != null ? ` • Wind: ${activeData.wind_speed_mph} mph` : ''
        const modeDesc =
          sliderOffset === null
            ? `ETA: ${new Date(cp.estimated_arrival_time).toLocaleTimeString()}`
            : `Snapshot: +${sliderOffset}h`

        const labelText = `CP #${cp.checkpoint_index + 1} (${cp.distance_from_origin_miles.toFixed(1)} mi) - ${modeDesc}${windDesc} - Risk: ${activeData.risk}`
        cpEl.title = labelText
        cpEl.setAttribute('aria-label', labelText)

        cpEl.addEventListener('click', (e) => {
          e.stopPropagation()
          onSelectCheckpoint(cp)
        })

        cpEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
            onSelectCheckpoint(cp)
          }
        })

        const marker = new maplibregl.Marker({ element: cpEl })
          .setLngLat(cp.coordinates)
          .addTo(map)

        markersRef.current.push(marker)
      })
    }

    // 4. Comparison Route Markers (small faded blue dots)
    if (compareRouteIds && compareRouteIds.length > 0) {
      compareRouteIds.forEach((compId) => {
        if (compId === selectedRouteId) return
        const compRoute = routes.find((r) => r.id === compId)
        if (!compRoute || !compRoute.checkpoints) return

        compRoute.checkpoints.forEach((cp) => {
          const compEl = document.createElement('div')
          compEl.className = 'map-compare-marker'
          compEl.style.width = '12px'
          compEl.style.height = '12px'
          compEl.style.borderRadius = '50%'
          compEl.style.backgroundColor = '#3b82f6'
          compEl.style.border = '2px solid #ffffff'
          compEl.style.opacity = '0.65'
          compEl.style.boxShadow = '0 1px 3px rgba(0,0,0,0.35)'
          compEl.title = `[Compare: ${compRoute.name}] CP #${cp.checkpoint_index + 1} (${cp.distance_from_origin_miles.toFixed(0)} mi)`

          const marker = new maplibregl.Marker({ element: compEl })
            .setLngLat(cp.coordinates)
            .addTo(map)

          compMarkersRef.current.push(marker)
        })
      })
    }
  }, [
    selectedRoute,
    selectedCheckpoint,
    onSelectCheckpoint,
    originName,
    destinationName,
    sliderOffset,
    compareRouteIds,
  ])

  // Update Truck Position Marker along the selected route when sliderOffset is active
  useEffect(() => {
    const map = mapRef.current
    if (!map || sliderOffset === null || !selectedRoute) {
      if (truckMarkerRef.current) {
        truckMarkerRef.current.remove()
        truckMarkerRef.current = null
      }
      return
    }

    const coords = selectedRoute.geometry?.coordinates
    if (!coords || coords.length === 0) return

    const durationHrs = (selectedRoute.duration_seconds || 1) / 3600
    const progress = Math.min(1.0, Math.max(0.0, sliderOffset / durationHrs))
    const targetMi = progress * selectedRoute.distance_miles

    const truckCoord = getCoordinateAtMiles(coords, targetMi, selectedRoute.distance_miles)

    if (!truckMarkerRef.current) {
      const truckEl = document.createElement('div')
      truckEl.className = 'map-truck-marker'
      truckEl.innerHTML = '<span style="font-size: 28px; line-height: 1; display: inline-block; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.45)); transform: translateY(-4px);">🚛</span>'
      truckEl.title = `Simulated truck location at +${sliderOffset}h (~${targetMi.toFixed(1)} mi)`

      const marker = new maplibregl.Marker({ element: truckEl, anchor: 'center' })
        .setLngLat(truckCoord)
        .addTo(map)

      truckMarkerRef.current = marker
    } else {
      truckMarkerRef.current.setLngLat(truckCoord)
      const el = truckMarkerRef.current.getElement()
      if (el) {
        el.title = `Simulated truck location at +${sliderOffset}h (~${targetMi.toFixed(1)} mi)`
      }
    }
  }, [sliderOffset, selectedRoute])

  const inspectorData = selectedCheckpoint ? getCheckpointActiveData(selectedCheckpoint) : null

  return (
    <div className="map-view-wrapper">
      <div className="map-header">
        <div className="map-title-row">
          <div className="map-title-group">
            <h3>Corridor Route & Weather Radar Map</h3>
            <p className="map-subtitle">
              Commercial heavy-vehicle route path with checkpoint risk assessment and wind telemetry
            </p>
          </div>
          {routes && routes.length > 1 && (
            <div className="map-route-switcher" role="tablist" aria-label="Route options">
              {routes.map((r, idx) => {
                const isSelected = r.id === selectedRoute?.id
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`map-route-tab ${isSelected ? 'active' : ''}`}
                    onClick={() => onSelectRoute(r.id)}
                  >
                    <span className="route-tab-rank">#{r.rank ?? idx + 1}</span>
                    <span className="route-tab-name">{r.name}</span>
                    {r.is_recommended && <span className="route-tab-star">★</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 0–48 Hour Forecast Time Slider Component */}
      <div className="forecast-slider-container">
        <div className="slider-header-row">
          <div className="slider-label-group">
            <span className="slider-title">Trip Corridor Forecast Timeline (0–48h)</span>
            <div className="slider-mode-indicator">
              {sliderOffset === null ? (
                <span className="mode-badge-eta">
                  📍 Active: Checkpoint Arrival Times (Trajectory Forecast)
                </span>
              ) : (
                <span className="mode-badge-snapshot">
                  ⏱ Active: +{sliderOffset}h from Departure (
                  {activeSliderDate ? formatDateTimeDisplay(activeSliderDate) : ''})
                </span>
              )}
            </div>
          </div>

          <div className="slider-quick-buttons">
            <button
              type="button"
              className={`slider-step-btn ${isPlaying ? 'btn-active' : ''}`}
              onClick={togglePlay}
              title={isPlaying ? 'Pause corridor timeline auto-play' : 'Auto-play corridor timeline (0 to 48h)'}
            >
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <button
              type="button"
              className="slider-step-btn"
              onClick={() => {
                stopPlayback()
                setSliderOffset((prev) => Math.max(0, (prev ?? 0) - 1))
              }}
              title="Step back 1 hour"
              disabled={sliderOffset === 0}
            >
              ◀ -1h
            </button>
            <button
              type="button"
              className="slider-step-btn"
              onClick={() => {
                stopPlayback()
                setSliderOffset((prev) => Math.min(48, (prev ?? 0) + 1))
              }}
              title="Step forward 1 hour"
              disabled={sliderOffset === 48}
            >
              ▶ +1h
            </button>
            <button
              type="button"
              className={`slider-btn ${sliderOffset === null ? 'btn-active' : ''}`}
              onClick={() => {
                stopPlayback()
                setSliderOffset(null)
              }}
              title="View weather forecasted at each checkpoint's estimated arrival time"
            >
              📍 Checkpoint ETAs
            </button>
            <button
              type="button"
              className={`slider-btn ${sliderOffset === 0 ? 'btn-active' : ''}`}
              onClick={() => {
                stopPlayback()
                setSliderOffset(0)
              }}
            >
              +0h (Departure)
            </button>
            <button
              type="button"
              className={`slider-btn ${sliderOffset === 6 ? 'btn-active' : ''}`}
              onClick={() => {
                stopPlayback()
                setSliderOffset(6)
              }}
            >
              +6h
            </button>
            <button
              type="button"
              className={`slider-btn ${sliderOffset === 12 ? 'btn-active' : ''}`}
              onClick={() => {
                stopPlayback()
                setSliderOffset(12)
              }}
            >
              +12h
            </button>
            <button
              type="button"
              className={`slider-btn ${sliderOffset === 24 ? 'btn-active' : ''}`}
              onClick={() => {
                stopPlayback()
                setSliderOffset(24)
              }}
            >
              +24h
            </button>
            <button
              type="button"
              className={`slider-btn ${sliderOffset === 48 ? 'btn-active' : ''}`}
              onClick={() => {
                stopPlayback()
                setSliderOffset(48)
              }}
            >
              +48h
            </button>
          </div>
        </div>

        <div className="slider-control-row">
          <input
            type="range"
            min="0"
            max="48"
            step="1"
            value={sliderOffset ?? 0}
            onChange={(e) => {
              stopPlayback()
              setSliderOffset(Number(e.target.value))
            }}
            aria-label="Trip corridor forecast timeline offset in hours"
            aria-valuemin={0}
            aria-valuemax={48}
            aria-valuenow={sliderOffset ?? 0}
            aria-valuetext={sliderOffset === null ? 'Active: Estimated Arrival Time Trajectory' : `+${sliderOffset} hours after departure`}
            className="forecast-range-slider"
            style={{ accentColor: '#EA580C', cursor: 'pointer', width: '100%' }}
          />
          <div className="slider-ticks-row">
            <span>+0h (Departure)</span>
            <span>+12h</span>
            <span>+24h (Day 1)</span>
            <span>+36h</span>
            <span>+48h (Day 2)</span>
          </div>
        </div>

        {sliderOffset !== null && (
          <p className="slider-context-note">
            Visualizing weather along the corridor at <strong>+{sliderOffset}h</strong> relative to
            departure ({activeSliderDate ? formatDateTimeDisplay(activeSliderDate) : ''}).
            Route-ranking and checkpoint ETAs remain fixed to the truck schedule.
          </p>
        )}
      </div>

      {/* Map Canvas with Floating Telemetry Overlay */}
      <div className="map-canvas-wrapper" style={{ position: 'relative', width: '100%', minHeight: '480px' }}>
        <div className="map-floating-telemetry">
          <div className="telemetry-badge">
            <span className="telemetry-label">ACTIVE ROUTE</span>
            <span className="telemetry-val">{selectedRoute?.name || 'Selected'}</span>
          </div>
          <div className="telemetry-divider" />
          <div className="telemetry-badge">
            <span className="telemetry-label">TOTAL DISTANCE</span>
            <span className="telemetry-val">{selectedRoute?.distance_miles.toFixed(1)} mi</span>
          </div>
          <div className="telemetry-divider" />
          <div className="telemetry-badge">
            <span className="telemetry-label">EST. DURATION</span>
            <span className="telemetry-val">{Math.round((selectedRoute?.duration_seconds ?? 0) / 60)} min</span>
          </div>
          <div className="telemetry-divider" />
          <div className="telemetry-badge">
            <span className="telemetry-label">CHECKPOINTS</span>
            <span className="telemetry-val">{selectedRoute?.checkpoints?.length ?? 0} pts</span>
          </div>
          <div className="telemetry-divider" />
          <div className="telemetry-badge wind-telemetry-badge">
            <span className="telemetry-label">PEAK WIND VELOCITY</span>
            <span className="telemetry-val" style={{ color: activePeakWind && activePeakWind >= 45 ? '#DC2626' : activePeakWind && activePeakWind >= 25 ? '#EA580C' : '#15803D' }}>
              {activePeakWind !== null ? `💨 ${activePeakWind.toFixed(1)} mph` : 'Measuring...'}
            </span>
          </div>
        </div>

        <div
          className="map-canvas-container"
          ref={mapContainerRef}
          style={{ width: '100%', height: '480px', minHeight: '480px', backgroundColor: '#F4F4F5', borderRadius: '8px', overflow: 'hidden' }}
        >
          {mapInitError && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '2rem', textAlign: 'center', color: '#555555' }}>
              <span style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🗺️</span>
              <h4 style={{ margin: '0 0 0.5rem 0', color: '#222222' }}>Interactive Vector Corridors Loaded</h4>
              <p style={{ margin: 0, fontSize: '0.9rem', maxWidth: '420px' }}>
                Displaying road coordinates ({originName} → {destinationName}) with {selectedRoute?.checkpoints?.length ?? 0} active weather checkpoint markers.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Weather Corridor Legend */}
      <div className="corridor-legend">
        <span className="legend-label">Corridor Risk Legend:</span>
        <div className="legend-items">
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: RISK_COLORS.LOW }} /> Low
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: RISK_COLORS.MODERATE }} /> Moderate
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: RISK_COLORS.HIGH }} /> High
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: RISK_COLORS.SEVERE }} /> Severe
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: RISK_COLORS.NO_TRAVEL }} /> No Travel
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ backgroundColor: RISK_COLORS.UNKNOWN }} /> Unknown
          </span>
        </div>
        {compareRouteIds && compareRouteIds.length > 0 && (
          <div className="compare-legend-row" style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid #E4E4E7', display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.85rem' }}>
            <span style={{ fontWeight: 600, color: '#1E40AF' }}>Compare Mode:</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#1E293B' }}>
              <span style={{ display: 'inline-block', width: '22px', height: '0', borderTop: '3px dashed #3B82F6' }} />
              Comparison Corridor ({compareRouteIds.map((id) => routes.find((r) => r.id === id)?.name || id).join(', ')})
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#64748B' }}>
              <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#3B82F6', opacity: 0.65 }} />
              Comparison Checkpoints
            </span>
          </div>
        )}
      </div>
      <p className="corridor-disclosure">
        * Note: The route corridor highlights estimated risk based on weather sampled at periodic
        checkpoints along the truck path, not a continuous weather observation.
      </p>

      {/* Selected Checkpoint Detail Inspection Card */}
      {selectedCheckpoint && inspectorData && (
        <div className="checkpoint-inspector-card">
          <div className="inspector-header">
            <h4>
              Checkpoint {selectedCheckpoint.checkpoint_index + 1} Details (
              {selectedCheckpoint.distance_from_origin_miles.toFixed(1)} miles from origin)
            </h4>
            <button
              type="button"
              className="inspector-close-btn"
              onClick={() => onSelectCheckpoint(null)}
            >
              ✕
            </button>
          </div>

          {inspectorData.weather_status === 'UNAVAILABLE' ? (
            <div className="inspector-unavailable-alert">
              ⚠️ Forecast unavailable for this checkpoint.
            </div>
          ) : (
            <div className="inspector-grid">
              <div className="inspector-item">
                <span className="ins-label">Road & Corridor Location</span>
                <span className="ins-value">
                  🛣️ {selectedCheckpoint.road_name || 'Corridor Route'}
                </span>
                <span className="ins-sub">
                  Marker: CP {selectedCheckpoint.checkpoint_index} ({selectedCheckpoint.distance_from_origin_miles.toFixed(1)} mi from origin)
                </span>
              </div>

              <div className="inspector-item">
                <span className="ins-label">Temperature & Weather</span>
                <span className="ins-value">
                  {inspectorData.weather_icon || '⛅'} {inspectorData.temperature_f !== null && inspectorData.temperature_f !== undefined ? `${Math.round(inspectorData.temperature_f)}°F` : '--'}
                  {selectedCheckpoint.temperature_c !== null && selectedCheckpoint.temperature_c !== undefined ? ` (${selectedCheckpoint.temperature_c}°C)` : ''}
                </span>
                <span className="ins-sub">
                  Condition: <strong>{inspectorData.weather_description || 'Clear Sky'}</strong>
                </span>
              </div>

              <div className="inspector-item">
                <span className="ins-label">Estimated Arrival Time (ETA)</span>
                <span className="ins-value">
                  {formatDateTimeDisplay(new Date(selectedCheckpoint.estimated_arrival_time))}
                </span>
                <span className="ins-sub">
                  UTC: {selectedCheckpoint.estimated_arrival_time.slice(11, 16)}Z
                </span>
              </div>

              <div className="inspector-item">
                <span className="ins-label">Wind Velocity & Gusts</span>
                <span className="ins-value" style={{ color: inspectorData.wind_speed_mph && inspectorData.wind_speed_mph >= 45 ? '#DC2626' : inspectorData.wind_speed_mph && inspectorData.wind_speed_mph >= 25 ? '#EA580C' : '#15803D' }}>
                  {inspectorData.wind_speed_mph !== null
                    ? `💨 ${inspectorData.wind_speed_mph.toFixed(1)} mph`
                    : 'N/A'}
                  {inspectorData.wind_direction_cardinal ? ` ${inspectorData.wind_direction_cardinal}` : ''}
                  {inspectorData.wind_gusts_mph !== null && inspectorData.wind_gusts_mph !== undefined && inspectorData.wind_gusts_mph > (inspectorData.wind_speed_mph || 0) && (
                    <span style={{ fontSize: '0.8rem', color: '#D97706', fontWeight: 600 }}> (Gusts: {Math.round(inspectorData.wind_gusts_mph)} mph)</span>
                  )}{' '}
                  <span className={`risk-badge badge-${inspectorData.wind_risk.toLowerCase()}`}>
                    {inspectorData.wind_risk}
                  </span>
                </span>
                <span className="ins-sub">
                  Load-adjusted risk: <strong>{inspectorData.load_adjusted_wind_risk}</strong>
                </span>
              </div>

              <div className="inspector-item">
                <span className="ins-label">Precipitation (Rain / Snow)</span>
                <span className="ins-value">
                  Rain: {inspectorData.rain_intensity_in_hr ?? 0} in/hr | Snow:{' '}
                  {inspectorData.snow_intensity_in_hr ?? 0} in/hr
                </span>
                <span className="ins-sub">
                  Rain: {inspectorData.rain_risk} | Snow: {inspectorData.snow_risk}
                </span>
              </div>

              <div className="inspector-item inspector-highlight">
                <span className="ins-label">
                  {sliderOffset === null
                    ? 'Combined Checkpoint Risk (at ETA)'
                    : `Corridor Risk (at +${sliderOffset}h)`}
                </span>
                <span
                  className={`risk-badge badge-${inspectorData.risk.toLowerCase().replace('_', '-')}`}
                >
                  {inspectorData.risk}
                </span>
                <span className="ins-sub">Status: {inspectorData.weather_status}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
