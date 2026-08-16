/* ==========================================================================
   MOCK DATA & GEOSPATIAL HELPER UTILITIES
   Provides GPX Route Waypoints, Checkpoints, Initial Riders, and Haversine Math
   ========================================================================== */

// Haversine formula to calculate distance between two coordinates in kilometers
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Sample Ultra-Cycling Route Points (Bentang Jawa Style: Monas Jakarta -> Banyuwangi)
export const SAMPLE_ROUTE = [
  { lat: -6.1754, lng: 106.8272, ele: 15, name: "START: Monas Jakarta", dist: 0 },
  { lat: -6.4025, lng: 106.7942, ele: 140, name: "Bogor Checkpoint", dist: 55 },
  { lat: -6.7026, lng: 106.9988, ele: 1480, name: "Puncak Pass Elevation", dist: 92 },
  { lat: -6.9175, lng: 107.6191, ele: 768, name: "CP1: Bandung City", dist: 160 },
  { lat: -6.8252, lng: 108.6253, ele: 25, name: "Cirebon Coast", dist: 285 },
  { lat: -6.9667, lng: 110.4167, ele: 12, name: "CP2: Semarang Central", dist: 460 },
  { lat: -7.5666, lng: 110.8166, ele: 105, name: "Solo Checkpoint", dist: 570 },
  { lat: -7.2575, lng: 112.7521, ele: 5, name: "CP3: Surabaya City", dist: 730 },
  { lat: -7.9425, lng: 112.9530, ele: 2329, name: "Bromo Mountain Climb", dist: 840 },
  { lat: -8.2192, lng: 114.3691, ele: 8, name: "FINISH: Ketapang Banyuwangi", dist: 1000 }
];

// High-resolution generated trackpoints for smooth map rendering & elevation profile
export function generateFullRoutePoints() {
  const fullPoints = [];
  let totalKm = 0;

  for (let i = 0; i < SAMPLE_ROUTE.length - 1; i++) {
    const p1 = SAMPLE_ROUTE[i];
    const p2 = SAMPLE_ROUTE[i + 1];
    const steps = 30; // interpolate 30 sub-points between key waypoints

    for (let s = 0; s < steps; s++) {
      const ratio = s / steps;
      const lat = p1.lat + (p2.lat - p1.lat) * ratio;
      const lng = p1.lng + (p2.lng - p1.lng) * ratio;
      
      // Add elevation noise & realistic terrain curve
      const ele = Math.round(p1.ele + (p2.ele - p1.ele) * ratio + Math.sin(ratio * Math.PI) * 120);

      if (fullPoints.length > 0) {
        const prev = fullPoints[fullPoints.length - 1];
        totalKm += calculateDistance(prev.lat, prev.lng, lat, lng);
      }

      fullPoints.push({
        lat: Number(lat.toFixed(5)),
        lng: Number(lng.toFixed(5)),
        ele: Math.max(0, ele),
        dist: Number(totalKm.toFixed(1))
      });
    }
  }

  return fullPoints;
}

// Sample Checkpoints list
export const SAMPLE_CHECKPOINTS = [
  { id: "start", name: "START: Monas Jakarta", km: 0, lat: -6.1754, lng: 106.8272 },
  { id: "cp1", name: "CP1: Bandung (KM 160)", km: 160, lat: -6.9175, lng: 107.6191 },
  { id: "cp2", name: "CP2: Semarang (KM 460)", km: 460, lat: -6.9667, lng: 110.4167 },
  { id: "cp3", name: "CP3: Surabaya (KM 730)", km: 730, lat: -7.2575, lng: 112.7521 },
  { id: "finish", name: "FINISH: Banyuwangi", km: 1000, lat: -8.2192, lng: 114.3691 }
];

// Initial Rider Fleet
export const INITIAL_RIDERS = [
  {
    id: "rider-101",
    bib: "101",
    name: "Raden Mas (Solo)",
    category: "Solo Unsupported",
    status: "moving",
    speed: 28.4,
    distanceKm: 580.2,
    eleGain: 4250,
    lat: -7.5666,
    lng: 110.8166,
    battery: 88,
    lastUpdate: "Just now",
    trail: [
      { lat: -6.1754, lng: 106.8272 },
      { lat: -6.9175, lng: 107.6191 },
      { lat: -6.8252, lng: 108.6253 },
      { lat: -6.9667, lng: 110.4167 },
      { lat: -7.5666, lng: 110.8166 }
    ]
  },
  {
    id: "rider-107",
    bib: "107",
    name: "Kartika Sari (Solo)",
    category: "Solo Unsupported",
    status: "moving",
    speed: 24.1,
    distanceKm: 512.6,
    eleGain: 3890,
    lat: -6.9667,
    lng: 110.4167,
    battery: 74,
    lastUpdate: "2 mins ago",
    trail: [
      { lat: -6.1754, lng: 106.8272 },
      { lat: -6.9175, lng: 107.6191 },
      { lat: -6.8252, lng: 108.6253 },
      { lat: -6.9667, lng: 110.4167 }
    ]
  },
  {
    id: "rider-204",
    bib: "204",
    name: "Budi & Siska (Pair)",
    category: "Pair Category",
    status: "stopped",
    speed: 0.0,
    distanceKm: 420.0,
    eleGain: 3100,
    lat: -6.8900,
    lng: 109.8000,
    battery: 62,
    lastUpdate: "14 mins ago (Resting)",
    trail: [
      { lat: -6.1754, lng: 106.8272 },
      { lat: -6.9175, lng: 107.6191 },
      { lat: -6.8252, lng: 108.6253 },
      { lat: -6.8900, lng: 109.8000 }
    ]
  },
  {
    id: "rider-309",
    bib: "309",
    name: "Agus Pratama (Solo)",
    category: "Solo Unsupported",
    status: "scratch",
    speed: 0.0,
    distanceKm: 290.4,
    eleGain: 2200,
    lat: -6.8252,
    lng: 108.6253,
    battery: 15,
    lastUpdate: "Scratch at CP1 (Mechanical)",
    trail: [
      { lat: -6.1754, lng: 106.8272 },
      { lat: -6.9175, lng: 107.6191 },
      { lat: -6.8252, lng: 108.6253 }
    ]
  }
];
