# Weather-Aware Truck Routing — Frontend

> Real-time commercial HGV route optimization and weather risk intelligence platform for heavy vehicle dispatchers.

**Live Production Deployment:** [https://truck-weather-frontend-waqe.vercel.app/](https://truck-weather-frontend-waqe.vercel.app/)

---

## Technology Stack

- **Frontend:** React 19, TypeScript 5.9, Vite 8.3, MapLibre GL JS 5.x
- **Backend:** Python 3.12+, Django 6.1+, Django REST Framework 3.18+
- **Routing Engine:** OpenStreetMap OSRM (turn-by-turn road network, highway classification, multi-corridor generation)
- **Meteorological Forecasts:** Open-Meteo API (hourly wind speed, gusts, rain precipitation rate, snowfall rate)
- **Mapping & Cartography:** MapLibre GL with WebGL-accelerated line-gradient corridor weather heatmaps and neutral light basemaps
- **Design System:** Zero-blue enterprise UI palette (charcoal `#222222`, orange `#EA580C`, off-white `#F7F7F5`, semantic risk tokens)

---

## Weather Risk Thresholds

Risk metrics are deterministically evaluated at periodic checkpoints along the trip corridor using the official assessment thresholds:

### Wind Speed Thresholds
| Wind Speed (mph) | Base Risk Level | Description |
| :--- | :--- | :--- |
| **< 25 mph** | `LOW` | Normal commercial highway driving conditions |
| **25 to < 35 mph** | `MODERATE` | Light buffeting, safe for all commercial loads |
| **35 to < 45 mph** | `HIGH` | Strong gusts, elevated steering vigilance required |
| **45 to < 55 mph** | `SEVERE` | Hazardous crosswind forces on high-profile trailers |
| **≥ 55 mph** | `NO_TRAVEL` | Severe rollover / blowover hazard; operations suspended |

### Rain Rate Thresholds
| Rain Intensity (in/hr) | Risk Level | Description |
| :--- | :--- | :--- |
| **< 0.10 in/hr** | `LOW` | Light mist or drizzle; normal tire traction |
| **0.10 to < 0.25 in/hr** | `MODERATE` | Moderate rainfall; wet pavement |
| **0.25 to < 0.50 in/hr** | `HIGH` | Heavy downpour; reduced visibility and hydroplaning risk |
| **0.50 to 1.00 in/hr** | `SEVERE` | Severe storm; localized standing water on highway |
| **> 1.00 in/hr** | `NO_TRAVEL` | Flash flood conditions; driving prohibited |

### Snow Rate Thresholds
| Snow Intensity (in/hr) | Risk Level | Description |
| :--- | :--- | :--- |
| **< 0.50 in/hr** | `LOW` | Flurries or light dusting |
| **0.50 to < 1.00 in/hr** | `MODERATE` | Steady snowfall; snow-packed lanes possible |
| **1.00 to < 2.00 in/hr** | `HIGH` | Heavy snow; compromised traction, reduced speed required |
| **2.00 to 3.00 in/hr** | `SEVERE` | Blizzard / near-whiteout conditions |
| **> 3.00 in/hr** | `NO_TRAVEL` | Impassable mountain passes / unplowed highways |

---

## Truck Cargo Load Adjustment Rules

Commercial heavy loads experience heightened vulnerability to crosswinds depending on gross vehicle weight. The system enforces 3 deterministic load rules:

1. **Rule 1 (Universal Safety Cap):** Wind $\ge 55\text{ mph} \to \text{NO\_TRAVEL}$ regardless of cargo weight.
2. **Rule 2 (Heavy Load Crosswind Escalation):** Wind $45\text{--}54\text{ mph}$ with load weight $> 30,000\text{ lbs} \to \text{NO\_TRAVEL}$ (blowover risk escalation).
3. **Rule 3 (Super-Heavy Load High-Wind Escalation):** Wind $35\text{--}44\text{ mph}$ with load weight $> 40,000\text{ lbs} \to \text{SEVERE}$.

*Note: Strict greater-than comparisons are applied to cargo weight thresholds.*

---

## Recommendation Priority Order

Route alternatives are ranked deterministically according to a 4-step hierarchy:

1. **Step 1:** Fewest total miles classified as `SEVERE`.
2. **Step 2:** Fewest total miles classified as `HIGH` (tie-breaker 1).
3. **Step 3:** Lowest average checkpoint risk score (tie-breaker 2).
4. **Step 4:** Shortest estimated travel duration in seconds (tie-breaker 3).
5. **Deterministic Tie-breaker:** Route ID ascending.

### Safety Guarantee
- Any route encountering a `NO_TRAVEL` checkpoint is **never** recommended.
- If all available corridors contain `NO_TRAVEL` hazards, the system returns an explicit travel warning and refuses recommendation.
- Missing or `UNKNOWN` meteorological data is scored conservatively with a penalty score of `3.0` (equivalent to `SEVERE`), ensuring incomplete data never masquerades as safe.

---

## Local Setup & Development

### 1. Prerequisites
- Node.js 18+ (Node 20 LTS recommended)
- Python 3.12+ (in virtual environment)

### 2. Backend Setup
```bash
# From workspace root
python -m venv .venv
.\.venv\Scripts\activate       # On Windows (or source .venv/bin/activate on Linux/macOS)
pip install -r requirements.txt

# Run migrations and start Django server
python manage.py migrate
python manage.py runserver 8001
```

### 3. Frontend Setup
```bash
cd frontend
npm install

# Environment Configuration (.env)
# VITE_API_BASE_URL=http://localhost:8001
npm run dev
```

The frontend will be running at `http://localhost:5173`.

---

## API Specification

### Endpoint: `POST /api/routes/`

#### Request Payload
```json
{
  "origin": "Chicago, IL",
  "destination": "Denver, CO",
  "departure_datetime": "2026-10-31T14:00:00Z",
  "load_weight_lbs": 35000,
  "sampling_interval_miles": 25
}
```

#### Request Fields
- `origin` *(string, required)*: Starting city, state, or address.
- `destination` *(string, required)*: Target city, state, or address.
- `departure_datetime` *(string, optional, ISO-8601)*: Projected departure time (defaults to current time).
- `load_weight_lbs` *(number, optional)*: Gross cargo weight in pounds (defaults to 0).
- `sampling_interval_miles` *(number, optional)*: Distance resolution between checkpoints (`10`, `25`, or `50`, defaults to `25`).

#### Key Response Fields
- `origin`: Geocoded name and `[lon, lat]` coordinates.
- `destination`: Geocoded name and `[lon, lat]` coordinates.
- `routes_count`: Number of viable route alternatives calculated.
- `recommended_route_id`: ID of the safest route option, or `null` if unsafe.
- `has_recommended_route`: Boolean flag indicating whether a safe route exists.
- `warning`: Travel warning string if `NO_TRAVEL` conditions prevail.
- `recommendation_rationale`: Human-readable explanation of why the route was chosen.
- `tradeoffs`: Comparative statistics across alternatives (time saved vs. weather exposure).
- `severe_alerts`: List of specific checkpoints exceeding safety thresholds.
- `routes`: Array of route objects, each containing:
  - `id`, `name`, `rank`, `is_recommended`, `has_no_travel`, `has_unknown_weather`
  - `distance_miles`, `duration_seconds`, `severe_miles`, `high_miles`, `average_risk_score`, `safety_score`
  - `roads_used`: Array of specific interstates, highways, and corridors traversed
  - `checkpoints`: Array of monitored checkpoints with:
    - `checkpoint_index`, `coordinates`, `distance_from_origin_miles`, `estimated_arrival_time`
    - `road_name`, `weather_code`, `weather_description`, `weather_icon`, `temperature_f`, `temperature_c`
    - `wind_speed_mph`, `wind_gusts_mph`, `wind_direction_cardinal`
    - `wind_risk`, `rain_risk`, `snow_risk`, `load_adjusted_wind_risk`, `final_risk`
    - `hourly_forecasts`: 48-hour forward projection for interactive timeline sliding

---

## Automated Verification & Testing

### Backend Unit & Integration Tests
```bash
python manage.py test routing
```
*Executes 44 rigorous test cases covering risk engines, load weight adjustments, route deduplication, OSRM fallbacks, and deterministic ranking.*

### Frontend Production Build
```bash
cd frontend
npm run build
```
*Validates TypeScript types and generates production bundles clean of errors.*

---

## Deployment Links

- **Frontend Application (Vercel):** [https://truck-weather-frontend-waqe.vercel.app/](https://truck-weather-frontend-waqe.vercel.app/)
- **Backend API (Cloud / Local):** Configured via `VITE_API_BASE_URL`

---

## Walkthrough

Watch a comprehensive end-to-end video walkthrough demonstrating route calculation, continuous gradient heatmap rendering, 0-48h forecast timeline scrubbing, and cargo weight risk escalation:

[LOOM_URL]
