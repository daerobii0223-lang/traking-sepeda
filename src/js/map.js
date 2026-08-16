/* ==========================================================================
   LEAFLET MAP & ELEVATION PROFILE ENGINE
   Handles Map rendering, Tile Switcher, Rider Markers, Dynamic Breadcrumb Trails, & Chart.js Elevation
   ========================================================================== */

import { SAMPLE_CHECKPOINTS } from './mock-data.js';

export class RacemapEngine {
  constructor(mapElementId, chartElementId) {
    this.mapId = mapElementId;
    this.chartId = chartElementId;
    this.map = null;
    this.chart = null;
    
    this.isFreeMode = false; // Mode Switcher: false = Fixed GPX, true = Free Tracking
    
    this.routePolyline = null;
    this.riderMarkers = new Map(); // bib -> L.marker
    this.riderTrails = new Map();   // bib -> L.polyline
    this.checkpointMarkers = [];
    
    this.selectedRiderBib = null;
    this.followedRiderBib = null;

    this.initMap();
    this.initChart();
  }

  // Initialize Leaflet Map with Multiple Tile Layers
  initMap() {
    // Default Map Center: Java Island Overview (Bandung / Central Java)
    this.map = L.map(this.mapId, {
      center: [-7.0, 110.0],
      zoom: 7,
      zoomControl: false
    });

    // Add Zoom Control to bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // Tile Layers
    this.tileLayers = {
      dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; CartoDB &copy; OpenStreetMap',
        maxZoom: 19
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; Esri World Imagery',
        maxZoom: 18
      }),
      topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenTopoMap',
        maxZoom: 17
      }),
      osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19
      })
    };

    // Default Tile: Dark Mode
    this.tileLayers.dark.addTo(this.map);
  }

  // Switch Base Map Tiles
  setTileLayer(tileName) {
    Object.values(this.tileLayers).forEach(layer => this.map.removeLayer(layer));
    if (this.tileLayers[tileName]) {
      this.tileLayers[tileName].addTo(this.map);
    }
  }

  // Render Fixed Route Line & Checkpoint Markers
  renderFixedRoute(routePoints) {
    if (this.routePolyline) {
      this.map.removeLayer(this.routePolyline);
    }

    const latLngs = routePoints.map(p => [p.lat, p.lng]);

    // Draw Neon Cyan Route Line
    this.routePolyline = L.polyline(latLngs, {
      color: '#00f2fe',
      weight: 5,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    // Fit map bounds to route
    this.map.fitBounds(this.routePolyline.getBounds(), { padding: [40, 40] });

    // Render Checkpoints
    this.clearCheckpoints();
    SAMPLE_CHECKPOINTS.forEach(cp => {
      const iconHtml = `
        <div style="background:#8b5cf6; color:#fff; border-radius:8px; padding:3px 7px; font-weight:800; font-size:11px; border:2px solid #fff; box-shadow:0 0 10px rgba(139,92,246,0.6); font-family:sans-serif; white-space:nowrap;">
          📍 ${cp.name}
        </div>
      `;
      
      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'cp-marker-label',
        iconSize: [120, 25],
        iconAnchor: [60, 12]
      });

      const marker = L.marker([cp.lat, cp.lng], { icon: customIcon }).addTo(this.map);
      this.checkpointMarkers.push(marker);
    });

    // Update Elevation Chart
    this.updateElevationChart(routePoints);
  }

  // Toggle Free Tracking Mode vs Fixed GPX Route
  setTrackingMode(isFree) {
    this.isFreeMode = isFree;
    
    if (this.isFreeMode) {
      // Hide Fixed Route Polyline and Checkpoints
      if (this.routePolyline) this.map.removeLayer(this.routePolyline);
      this.clearCheckpoints();
    }
  }

  clearCheckpoints() {
    this.checkpointMarkers.forEach(m => this.map.removeLayer(m));
    this.checkpointMarkers = [];
  }

  // Update or Create Rider Location Marker & Dynamic Trail
  updateRiderPosition(rider) {
    const { bib, name, lat, lng, speed, status, battery, distanceKm, category, trail } = rider;
    const latLng = [lat, lng];

    // Status styling
    let statusClass = 'moving';
    let statusColor = '#10b981'; // Green
    if (status === 'stopped') { statusClass = 'stopped'; statusColor = '#f59e0b'; }
    if (status === 'scratch') { statusClass = 'scratch'; statusColor = '#ef4444'; }
    if (status === 'finish') { statusClass = 'finish'; statusColor = '#8b5cf6'; }

    // Custom HTML Pulsing Marker
    const markerHtml = `
      <div class="rider-marker-pin ${statusClass === 'moving' ? 'pulse' : ''}" style="border-color:${statusColor}">
        ${bib}
      </div>
    `;

    const icon = L.divIcon({
      html: markerHtml,
      className: 'leaflet-rider-marker',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    // If marker exists, update position smoothly
    if (this.riderMarkers.has(bib)) {
      const marker = this.riderMarkers.get(bib);
      marker.setLatLng(latLng);
      marker.setIcon(icon);
    } else {
      // Create new marker
      const marker = L.marker(latLng, { icon }).addTo(this.map);
      
      // Popup Content
      const popupHtml = `
        <div class="popup-rider-card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:800; font-size:14px; color:#fff;">BIB #${bib} - ${name}</span>
          </div>
          <div style="font-size:11px; color:#9ca3af;">${category}</div>
          <hr style="border:0; border-top:1px solid rgba(255,255,255,0.1); margin:4px 0;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:12px; font-family:monospace;">
            <div>⚡ Speed: <b>${speed} km/h</b></div>
            <div>📍 Dist: <b>${distanceKm} KM</b></div>
            <div>🔋 Bat: <b>${battery}%</b></div>
            <div>STATUS: <b style="color:${statusColor}; text-transform:uppercase;">${status}</b></div>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.on('click', () => {
        this.selectedRiderBib = bib;
      });

      this.riderMarkers.set(bib, marker);
    }

    // Dynamic Breadcrumb Trail Plotting (Draw line of where rider has traveled)
    if (trail && trail.length > 0) {
      const trailLatLngs = trail.map(t => [t.lat, t.lng]);
      
      if (this.riderTrails.has(bib)) {
        this.riderTrails.get(bib).setLatLngs(trailLatLngs);
      } else {
        const polyline = L.polyline(trailLatLngs, {
          color: statusColor,
          weight: 3,
          dashArray: '5, 8',
          opacity: 0.8
        }).addTo(this.map);
        
        this.riderTrails.set(bib, polyline);
      }
    }

    // Camera Lock onto Followed Rider
    if (this.followedRiderBib === bib) {
      this.map.panTo(latLng);
    }
  }

  // Follow Rider Camera
  followRider(bib) {
    this.followedRiderBib = bib;
    if (this.riderMarkers.has(bib)) {
      const marker = this.riderMarkers.get(bib);
      this.map.setView(marker.getLatLng(), 13, { animate: true });
      marker.openPopup();
    }
  }

  // Unfollow Camera
  unfollow() {
    this.followedRiderBib = null;
  }

  // Initialize Chart.js Elevation Profile
  initChart() {
    const canvas = document.getElementById(this.chartId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // Gradient fill under profile line
    const gradient = ctx.createLinearGradient(0, 0, 0, 120);
    gradient.addColorStop(0, 'rgba(0, 242, 254, 0.35)');
    gradient.addColorStop(1, 'rgba(0, 242, 254, 0.0)');

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Elevation (m)',
          data: [],
          borderColor: '#00f2fe',
          borderWidth: 2,
          fill: true,
          backgroundColor: gradient,
          tension: 0.3,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (context) => `${context.parsed.y} m elevation`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#6b7280', font: { size: 10 } }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#6b7280', font: { size: 10 } }
          }
        }
      }
    });
  }

  // Update Elevation Chart with GPX Waypoint data
  updateElevationChart(routePoints) {
    if (!this.chart) return;

    const labels = routePoints.map(p => `${p.dist} km`);
    const eleData = routePoints.map(p => p.ele);

    this.chart.data.labels = labels;
    this.chart.data.datasets[0].data = eleData;
    this.chart.update();
  }
}
