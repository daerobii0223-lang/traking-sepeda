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
    
    this.isFreeMode = false;
    
    this.routePolyline = null;
    this.riderMarkers = new Map(); // bib -> L.marker
    this.riderTrails = new Map();   // bib -> L.polyline
    this.checkpointMarkers = [];
    
    this.selectedRiderBib = null;
    this.followedRiderBib = null;

    this.initMap();
    this.initChart();
  }

  initMap() {
    this.map = L.map(this.mapId, {
      center: [-7.0, 110.0],
      zoom: 7,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

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

    this.tileLayers.dark.addTo(this.map);
  }

  setTileLayer(tileName) {
    Object.values(this.tileLayers).forEach(layer => this.map.removeLayer(layer));
    if (this.tileLayers[tileName]) {
      this.tileLayers[tileName].addTo(this.map);
    }
  }

  renderFixedRoute(routePoints) {
    if (!routePoints || routePoints.length === 0) return;

    if (this.routePolyline) {
      this.map.removeLayer(this.routePolyline);
    }

    const latLngs = routePoints.map(p => [p.lat, p.lng]);

    this.routePolyline = L.polyline(latLngs, {
      color: '#00f2fe',
      weight: 4,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    this.map.fitBounds(this.routePolyline.getBounds(), { padding: [30, 30] });

    this.clearCheckpoints();
    SAMPLE_CHECKPOINTS.forEach(cp => {
      const iconHtml = `
        <div style="background:#8b5cf6; color:#fff; border-radius:6px; padding:2px 6px; font-weight:800; font-size:10px; border:1px solid #fff; box-shadow:0 0 8px rgba(139,92,246,0.6); font-family:sans-serif; white-space:nowrap;">
          📍 ${cp.name}
        </div>
      `;
      
      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'cp-marker-label',
        iconSize: [110, 22],
        iconAnchor: [55, 11]
      });

      const marker = L.marker([cp.lat, cp.lng], { icon: customIcon }).addTo(this.map);
      this.checkpointMarkers.push(marker);
    });

    this.updateElevationChart(routePoints);
  }

  setTrackingMode(isFree) {
    this.isFreeMode = isFree;
    
    if (this.isFreeMode) {
      if (this.routePolyline) this.map.removeLayer(this.routePolyline);
      this.clearCheckpoints();
    }
  }

  clearCheckpoints() {
    this.checkpointMarkers.forEach(m => this.map.removeLayer(m));
    this.checkpointMarkers = [];
  }

  // Update or Create Rider Location Marker
  // CRITICAL FIX: Only render marker if lat/lng are non-null and rider has actually sent location!
  updateRiderPosition(rider) {
    const { bib, name, lat, lng, speed, status, battery, distanceKm, category, trail } = rider;

    // IF RIDER HAS NOT STARTED TRACKING YET (lat/lng is null or status is registered), REMOVE/SKIP MARKER!
    if (lat === null || lng === null || status === 'registered') {
      if (this.riderMarkers.has(bib)) {
        this.map.removeLayer(this.riderMarkers.get(bib));
        this.riderMarkers.delete(bib);
      }
      if (this.riderTrails.has(bib)) {
        this.map.removeLayer(this.riderTrails.get(bib));
        this.riderTrails.delete(bib);
      }
      return;
    }

    const latLng = [lat, lng];

    let statusClass = 'moving';
    let statusColor = '#10b981';
    if (status === 'stopped') { statusClass = 'stopped'; statusColor = '#f59e0b'; }
    if (status === 'scratch') { statusClass = 'scratch'; statusColor = '#ef4444'; }
    if (status === 'finish') { statusClass = 'finish'; statusColor = '#8b5cf6'; }

    const markerHtml = `
      <div class="rider-marker-pin ${statusClass === 'moving' ? 'pulse' : ''}" style="border-color:${statusColor}">
        ${bib}
      </div>
    `;

    const icon = L.divIcon({
      html: markerHtml,
      className: 'leaflet-rider-marker',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    if (this.riderMarkers.has(bib)) {
      const marker = this.riderMarkers.get(bib);
      marker.setLatLng(latLng);
      marker.setIcon(icon);
    } else {
      const marker = L.marker(latLng, { icon }).addTo(this.map);
      
      const popupHtml = `
        <div class="popup-rider-card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:800; font-size:13px; color:#fff;">BIB #${bib} - ${name}</span>
          </div>
          <div style="font-size:10px; color:#9ca3af;">${category || 'Solo'}</div>
          <hr style="border:0; border-top:1px solid rgba(255,255,255,0.1); margin:4px 0;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:11px; font-family:monospace;">
            <div>⚡ Speed: <b>${speed || 0} km/h</b></div>
            <div>📍 Dist: <b>${distanceKm || 0} KM</b></div>
            <div>🔋 Bat: <b>${battery || 100}%</b></div>
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

    if (trail && trail.length > 0) {
      const trailLatLngs = trail.map(t => [t.lat, t.lng]);
      
      if (this.riderTrails.has(bib)) {
        this.riderTrails.get(bib).setLatLngs(trailLatLngs);
      } else {
        const polyline = L.polyline(trailLatLngs, {
          color: statusColor,
          weight: 3,
          dashArray: '4, 6',
          opacity: 0.8
        }).addTo(this.map);
        
        this.riderTrails.set(bib, polyline);
      }
    }

    if (this.followedRiderBib === bib) {
      this.map.panTo(latLng);
    }
  }

  followRider(bib) {
    this.followedRiderBib = bib;
    if (this.riderMarkers.has(bib)) {
      const marker = this.riderMarkers.get(bib);
      this.map.setView(marker.getLatLng(), 13, { animate: true });
      marker.openPopup();
    }
  }

  unfollow() {
    this.followedRiderBib = null;
  }

  initChart() {
    const canvas = document.getElementById(this.chartId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 100);
    gradient.addColorStop(0, 'rgba(56, 189, 248, 0.3)');
    gradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Elevation (m)',
          data: [],
          borderColor: '#38bdf8',
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
          legend: { display: false }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 9 } } },
          y: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: '#64748b', font: { size: 9 } } }
        }
      }
    });
  }

  updateElevationChart(routePoints) {
    if (!this.chart || !routePoints) return;

    const labels = routePoints.map(p => `${p.dist} km`);
    const eleData = routePoints.map(p => p.ele);

    this.chart.data.labels = labels;
    this.chart.data.datasets[0].data = eleData;
    this.chart.update();
  }
}
